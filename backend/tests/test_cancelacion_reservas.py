"""Cancelación de reservas por el socio: GET /reservas/{id}/cancelacion y POST /reservas/{id}/cancelar (Issue 22.2)."""
import random
import uuid
from datetime import timedelta
from decimal import Decimal

import jwt
import pytest
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.pago import Pago
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import RoleEnum, User
from schemas.reserva import hoy_argentina
from services.cancelacion_service import (
    calcular_monto_a_devolver,
    fecha_limite_cancelacion,
    formatear_pesos,
    mensaje_fuera_de_plazo,
)
from services.capacity_service import CapacityService
from services.payment_service import ResultadoConfirmacion, confirmar_pago, payment_service

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado (FK)
pytestmark = pytest.mark.usefixtures("camping_de_prueba")

MONTO = 15000.0
PERSONAS = 3


# ---------- Dobles de prueba ----------

class MercadoPagoFalso:
    """Registra cada reembolso pedido como (payment_id, refund_object)."""

    def __init__(self):
        self.reembolsos = []
        self.reembolso_falla = False

    def refund(self):
        return self

    def create(self, payment_id, refund_object=None, request_options=None):
        self.reembolsos.append((str(payment_id), refund_object))
        if self.reembolso_falla:
            return {"status": 500, "response": {"message": "internal_error"}}
        return {"status": 201, "response": {"id": 1, "payment_id": payment_id, "status": "approved"}}


class EmailServiceFalso:
    def __init__(self):
        self.cancelaciones = []

    def enviar_cancelacion_sync(self, destinatario, datos_reserva):
        self.cancelaciones.append({"destinatario": destinatario, **datos_reserva})


# ---------- Fixtures y helpers ----------

@pytest.fixture(autouse=True)
def sin_override_de_autenticacion():
    """Acá se usan tokens reales: se quita el reemplazo de get_current_user mientras corre cada test."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


@pytest.fixture
def mp(monkeypatch):
    falso = MercadoPagoFalso()
    monkeypatch.setattr(payment_service, "mp", falso)
    return falso


@pytest.fixture
def correo(monkeypatch):
    falso = EmailServiceFalso()
    monkeypatch.setattr("services.cancelacion_service.email_service", falso)
    return falso


@pytest.fixture
def reglas(configurar_camping):
    """Fija el plazo de cancelación y el porcentaje de devolución solo durante el test."""
    def _fijar(dias=1, porcentaje=100):
        configurar_camping(dias_cancelacion=dias, porcentaje_devolucion=porcentaje)
    _fijar()
    return _fijar


def _token(user_id) -> dict:
    token = jwt.encode({"sub": str(user_id)}, settings.AUTH_SECRET_KEY, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def datos():
    """Crea usuarios, reservas y pagos, y los borra al terminar."""
    creados = {"usuarios": [], "reservas": []}

    def crear_usuario(rol=RoleEnum.CLIENTE):
        db = SessionLocal()
        try:
            usuario = User(
                email=f"cancelacion_{uuid.uuid4()}@grupo8.com",
                password_hash="secreto",
                nombre="Socio Cancelación",
                dni=str(uuid.uuid4().int)[:8],
                rol=rol,
            )
            db.add(usuario)
            db.commit()
            creados["usuarios"].append(usuario.id)
            return usuario.id
        finally:
            db.close()

    def crear_reserva(
        user_id,
        dias_hasta_ingreso=30,
        estado_reserva=EstadoReservaEnum.CONFIRMADA,
        estado_pago=EstadoPagoEnum.PAGADO,
        con_pago=True,
    ):
        """Reserva pagada (por defecto) con su pago aprobado en la tabla pagos."""
        ingreso = hoy_argentina() + timedelta(days=dias_hasta_ingreso)
        db = SessionLocal()
        try:
            reserva = Reserva(
                user_id=user_id,
                camping_id=settings.CAMPING_ID,
                fecha_ingreso=ingreso,
                fecha_egreso=ingreso + timedelta(days=2),
                cantidad_personas=PERSONAS,
                monto_total=MONTO,
                titular="Titular Cancelación",
                email="titular.cancelacion@grupo8.com",
                estado_reserva=estado_reserva,
                estado_pago=estado_pago,
            )
            db.add(reserva)
            db.flush()
            payment_id = None
            if con_pago:
                payment_id = str(random.randint(10**11, 10**12 - 1))
                db.add(Pago(
                    reserva_id=reserva.id,
                    mp_payment_id=payment_id,
                    estado="approved",
                    monto=Decimal(str(MONTO)),
                    moneda="ARS",
                    metodo_pago="visa",
                    respuesta_mp={"status": "approved"},
                ))
            db.commit()
            creados["reservas"].append(reserva.id)
            return reserva.id, payment_id
        finally:
            db.close()

    yield crear_usuario, crear_reserva

    db = SessionLocal()
    try:
        db.query(Pago).filter(Pago.reserva_id.in_(creados["reservas"])).delete(synchronize_session=False)
        db.query(IngresoFisico).filter(IngresoFisico.reserva_id.in_(creados["reservas"])).delete(
            synchronize_session=False
        )
        db.query(Reserva).filter(Reserva.id.in_(creados["reservas"])).delete(synchronize_session=False)
        db.query(User).filter(User.id.in_(creados["usuarios"])).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _reserva(reserva_id) -> Reserva:
    db = SessionLocal()
    try:
        return db.query(Reserva).filter(Reserva.id == reserva_id).one()
    finally:
        db.close()


def _pago(mp_payment_id) -> Pago:
    db = SessionLocal()
    try:
        return db.query(Pago).filter(Pago.mp_payment_id == str(mp_payment_id)).one()
    finally:
        db.close()


def _consultar(reserva_id, user_id):
    return client.get(f"/reservas/{reserva_id}/cancelacion", headers=_token(user_id))


def _cancelar(reserva_id, user_id):
    return client.post(f"/reservas/{reserva_id}/cancelar", headers=_token(user_id))


# ---------- Reglas ----------

def test_la_fecha_limite_resta_los_dias_al_ingreso():
    ingreso = hoy_argentina()
    assert fecha_limite_cancelacion(ingreso, 1) == ingreso - timedelta(days=1)
    assert fecha_limite_cancelacion(ingreso, 0) == ingreso


@pytest.mark.parametrize("monto, porcentaje, esperado", [
    ("15000", 100, "15000.00"),
    ("15000", 50, "7500.00"),
    ("15000", 0, "0.00"),
    # 33 % de 100,01 = 33,0033: se redondea hacia abajo para no devolver de más
    ("100.01", 33, "33.00"),
    ("999.99", 15, "149.99"),
])
def test_monto_a_devolver(monto, porcentaje, esperado):
    assert calcular_monto_a_devolver(Decimal(monto), porcentaje) == Decimal(esperado)


@pytest.mark.parametrize("dias, mensaje", [
    (1, "Lo sentimos, las reservas solo se pueden cancelar hasta 1 día antes del ingreso."),
    (3, "Lo sentimos, las reservas solo se pueden cancelar hasta 3 días antes del ingreso."),
    (0, "Lo sentimos, las reservas solo se pueden cancelar hasta el mismo día del ingreso."),
])
def test_mensaje_fuera_de_plazo(dias, mensaje):
    assert mensaje_fuera_de_plazo(dias) == mensaje


def test_los_montos_se_escriben_en_pesos_argentinos():
    assert formatear_pesos(Decimal("7500")) == "$ 7.500,00"
    assert formatear_pesos(Decimal("1234567.5")) == "$ 1.234.567,50"


# ---------- GET /reservas/{id}/cancelacion ----------

def test_consulta_dentro_del_plazo_informa_condiciones_y_monto(datos, reglas):
    crear_usuario, crear_reserva = datos
    reglas(dias=2, porcentaje=50)
    socio = crear_usuario()
    reserva_id, _ = crear_reserva(socio, dias_hasta_ingreso=10)

    response = _consultar(reserva_id, socio)

    assert response.status_code == 200, response.text
    ingreso = hoy_argentina() + timedelta(days=10)
    # Mismos campos que fija contratos_sprint6.md
    assert response.json() == {
        "puede_cancelar": True,
        "dias_minimos": 2,
        "fecha_limite": (ingreso - timedelta(days=2)).isoformat(),
        "porcentaje_devolucion": 50,
        "monto_devolucion": 7500.0,
        "mensaje": None,
    }


def test_consulta_fuera_del_plazo_explica_por_que(datos, reglas):
    crear_usuario, crear_reserva = datos
    reglas(dias=3)
    socio = crear_usuario()
    reserva_id, _ = crear_reserva(socio, dias_hasta_ingreso=2)

    data = _consultar(reserva_id, socio).json()

    assert data["puede_cancelar"] is False
    assert data["mensaje"] == "Lo sentimos, las reservas solo se pueden cancelar hasta 3 días antes del ingreso."


def test_consultar_la_reserva_de_otro_usuario_da_404(datos, reglas):
    crear_usuario, crear_reserva = datos
    reserva_id, _ = crear_reserva(crear_usuario())

    assert _consultar(reserva_id, crear_usuario()).status_code == 404


def test_sin_token_da_401(datos, reglas):
    crear_usuario, crear_reserva = datos
    reserva_id, _ = crear_reserva(crear_usuario())

    assert client.get(f"/reservas/{reserva_id}/cancelacion").status_code == 401
    assert client.post(f"/reservas/{reserva_id}/cancelar").status_code == 401


# ---------- POST /reservas/{id}/cancelar ----------

def test_cancela_dentro_del_plazo_y_devuelve_el_total(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    socio = crear_usuario()
    reserva_id, payment_id = crear_reserva(socio)

    response = _cancelar(reserva_id, socio)

    assert response.status_code == 200, response.text
    data = response.json()
    # Como fija el contrato: la reserva actualizada y el monto devuelto
    assert data["id"] == str(reserva_id)
    assert data["estado_reserva"] == EstadoReservaEnum.CANCELADA.value
    assert data["monto_devuelto"] == MONTO
    assert data["devolucion_realizada"] is True
    reserva = _reserva(reserva_id)
    # El pago sigue en PAGADO: así un aviso posterior de Mercado Pago no la vuelve a confirmar
    assert (reserva.estado_reserva, reserva.estado_pago) == (EstadoReservaEnum.CANCELADA, EstadoPagoEnum.PAGADO)
    # Con el 100 % se pide la devolución total
    assert mp.reembolsos == [(payment_id, None)]
    pago = _pago(payment_id)
    assert (pago.estado, pago.monto_devuelto, pago.devolucion_estado) == ("refunded", Decimal("15000.00"), "devuelto")
    assert pago.fecha_devolucion is not None


def test_reembolso_parcial_devuelve_solo_el_porcentaje(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    reglas(porcentaje=50)
    socio = crear_usuario()
    reserva_id, payment_id = crear_reserva(socio)

    response = _cancelar(reserva_id, socio)

    assert response.status_code == 200, response.text
    assert response.json()["monto_devuelto"] == 7500.0
    assert mp.reembolsos == [(payment_id, {"amount": 7500.0})]
    pago = _pago(payment_id)
    # En una devolución parcial Mercado Pago deja el pago aprobado
    assert (pago.estado, pago.monto_devuelto, pago.devolucion_estado) == ("approved", Decimal("7500.00"), "devuelto")


def test_con_0_por_ciento_cancela_sin_pedir_devolucion(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    reglas(porcentaje=0)
    socio = crear_usuario()
    reserva_id, payment_id = crear_reserva(socio)

    response = _cancelar(reserva_id, socio)

    assert response.status_code == 200, response.text
    assert mp.reembolsos == []
    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.CANCELADA
    assert _pago(payment_id).monto_devuelto == Decimal("0.00")
    assert "no tiene devolución" in correo.cancelaciones[0]["detalle_devolucion"]


def test_se_puede_cancelar_el_ultimo_dia_del_plazo(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    reglas(dias=1)
    socio = crear_usuario()
    # Ingreso mañana: con 1 día, hoy es el último día para cancelar
    reserva_id, _ = crear_reserva(socio, dias_hasta_ingreso=1)

    assert _cancelar(reserva_id, socio).status_code == 200


@pytest.mark.parametrize("dias, dias_hasta_ingreso, mensaje", [
    (1, 0, "Lo sentimos, las reservas solo se pueden cancelar hasta 1 día antes del ingreso."),
    (5, 4, "Lo sentimos, las reservas solo se pueden cancelar hasta 5 días antes del ingreso."),
    (0, -1, "Lo sentimos, las reservas solo se pueden cancelar hasta el mismo día del ingreso."),
])
def test_fuera_del_plazo_da_422_y_no_cambia_nada(datos, reglas, mp, correo, dias, dias_hasta_ingreso, mensaje):
    crear_usuario, crear_reserva = datos
    reglas(dias=dias)
    socio = crear_usuario()
    reserva_id, payment_id = crear_reserva(socio, dias_hasta_ingreso=dias_hasta_ingreso)

    response = _cancelar(reserva_id, socio)

    assert response.status_code == 422
    assert response.json()["detail"] == mensaje
    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.CONFIRMADA
    assert mp.reembolsos == []
    assert _pago(payment_id).devolucion_estado is None
    assert correo.cancelaciones == []


def test_otro_usuario_no_puede_cancelar(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    reserva_id, _ = crear_reserva(crear_usuario())

    response = _cancelar(reserva_id, crear_usuario())

    assert response.status_code == 404
    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.CONFIRMADA
    assert mp.reembolsos == []


def test_una_reserva_sin_pagar_no_se_puede_cancelar(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    socio = crear_usuario()
    reserva_id, _ = crear_reserva(
        socio, estado_reserva=EstadoReservaEnum.PENDIENTE, estado_pago=EstadoPagoEnum.PENDIENTE, con_pago=False
    )

    response = _cancelar(reserva_id, socio)

    assert response.status_code == 422
    assert response.json()["detail"] == "Solo se pueden cancelar reservas pagadas."
    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.PENDIENTE


def test_una_reserva_en_alerta_de_clonacion_no_se_puede_cancelar(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    socio = crear_usuario()
    reserva_id, _ = crear_reserva(socio, estado_reserva=EstadoReservaEnum.ALERTA_CLONACION)

    response = _cancelar(reserva_id, socio)

    assert response.status_code == 422
    assert "en revisión" in response.json()["detail"]
    assert mp.reembolsos == []


def test_con_0_dias_no_se_cancela_si_ya_ingreso(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    reglas(dias=0)
    socio = crear_usuario()
    reserva_id, _ = crear_reserva(socio, dias_hasta_ingreso=0)
    db = SessionLocal()
    try:
        db.add(IngresoFisico(
            reserva_id=reserva_id,
            tipo_ingreso=TipoIngresoEnum.WEB,
            jti=f"jti-{uuid.uuid4()}",
            cantidad_personas=PERSONAS,
        ))
        db.commit()
    finally:
        db.close()

    response = _cancelar(reserva_id, socio)

    assert response.status_code == 422
    assert response.json()["detail"] == "No se puede cancelar una reserva que ya registró un ingreso al camping."


def test_cancelar_dos_veces_devuelve_una_sola_vez(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    socio = crear_usuario()
    reserva_id, payment_id = crear_reserva(socio)

    assert _cancelar(reserva_id, socio).status_code == 200
    segunda = _cancelar(reserva_id, socio)

    assert segunda.status_code == 422
    assert segunda.json()["detail"] == "La reserva ya está cancelada."
    assert len(mp.reembolsos) == 1
    assert len(correo.cancelaciones) == 1


def test_si_falla_el_reembolso_queda_cancelada_y_marcada_para_revision(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    reglas(porcentaje=50)
    mp.reembolso_falla = True
    socio = crear_usuario()
    reserva_id, payment_id = crear_reserva(socio)

    response = _cancelar(reserva_id, socio)

    assert response.status_code == 200, response.text
    assert response.json()["devolucion_realizada"] is False
    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.CANCELADA
    pago = _pago(payment_id)
    assert (pago.estado, pago.monto_devuelto, pago.devolucion_estado) == (
        "approved", Decimal("7500.00"), "pendiente_revision"
    )
    assert pago.fecha_devolucion is None
    assert "Estamos procesando la devolución de $ 7.500,00" in correo.cancelaciones[0]["detalle_devolucion"]


def test_sin_pago_registrado_queda_cancelada_y_para_revision(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    socio = crear_usuario()
    reserva_id, _ = crear_reserva(socio, con_pago=False)

    response = _cancelar(reserva_id, socio)

    assert response.status_code == 200
    assert response.json()["devolucion_realizada"] is False
    assert mp.reembolsos == []
    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.CANCELADA


# ---------- Efectos de la cancelación ----------

def test_se_envia_el_correo_con_el_monto_devuelto(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    reglas(porcentaje=50)
    socio = crear_usuario()
    reserva_id, _ = crear_reserva(socio)

    _cancelar(reserva_id, socio)

    assert len(correo.cancelaciones) == 1
    enviado = correo.cancelaciones[0]
    assert enviado["destinatario"] == "titular.cancelacion@grupo8.com"
    assert enviado["reserva_id"] == str(reserva_id)
    assert enviado["motivo_cancelacion"] == "Cancelaste la reserva desde Mis reservas."
    assert "Te devolvimos $ 7.500,00 (50 % de lo que pagaste)" in enviado["detalle_devolucion"]


def test_la_reserva_cancelada_libera_el_cupo(datos, reglas, mp, correo, configurar_camping):
    crear_usuario, crear_reserva = datos
    socio = crear_usuario()
    # Fechas propias, lejos de las de otros tests
    dias = random.randint(2000, 9000)
    reserva_id, _ = crear_reserva(socio, dias_hasta_ingreso=dias)
    ingreso = hoy_argentina() + timedelta(days=dias)
    configurar_camping(capacidad_total=PERSONAS, porcentaje_buffer_offline=0)
    db = SessionLocal()
    try:
        assert CapacityService().hay_cupo(db, ingreso, ingreso + timedelta(days=2), PERSONAS) is False

        assert _cancelar(reserva_id, socio).status_code == 200

        assert CapacityService().hay_cupo(db, ingreso, ingreso + timedelta(days=2), PERSONAS) is True
    finally:
        db.close()


def test_la_reserva_cancelada_aparece_en_las_canceladas_del_bootstrap(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    socio = crear_usuario()
    guardia = crear_usuario(RoleEnum.SEGURIDAD)
    reserva_id, _ = crear_reserva(socio)

    _cancelar(reserva_id, socio)
    response = client.get("/api/v1/sincronizacion/bootstrap", headers=_token(guardia))

    assert response.status_code == 200
    assert str(reserva_id) in response.json()["blacklist"]


def test_el_qr_de_una_reserva_cancelada_ya_no_se_descarga(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    socio = crear_usuario()
    reserva_id, _ = crear_reserva(socio)

    _cancelar(reserva_id, socio)

    assert client.get(f"/reservas/{reserva_id}/qr", headers=_token(socio)).status_code == 403


def test_un_aviso_posterior_de_mercado_pago_no_vuelve_a_confirmarla(datos, reglas, mp, correo):
    crear_usuario, crear_reserva = datos
    reglas(porcentaje=50)
    socio = crear_usuario()
    reserva_id, payment_id = crear_reserva(socio)
    _cancelar(reserva_id, socio)

    # Después de una devolución parcial Mercado Pago vuelve a avisar el pago como aprobado
    db = SessionLocal()
    try:
        resultado = confirmar_pago(
            db, reserva_id, BackgroundTasks(), monto_cobrado=MONTO, mp_payment_id=payment_id
        )
    finally:
        db.close()

    assert resultado == ResultadoConfirmacion.YA_PAGADA
    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.CANCELADA
    assert len(mp.reembolsos) == 1
