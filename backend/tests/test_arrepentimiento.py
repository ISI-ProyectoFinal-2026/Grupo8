"""Botón de arrepentimiento sin cuenta: POST /arrepentimiento/solicitud, GET /arrepentimiento/condiciones
y POST /arrepentimiento/confirmar (Issue 25.2)."""
import random
import uuid
from datetime import date, timedelta
from decimal import Decimal
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient

from core.config import settings
from core.database import SessionLocal
from core.tiempo import ahora_utc
from main import app
from models.pago import Pago
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from schemas.reserva import hoy_argentina
from services import payment_service as payment_module
from services.arrepentimiento_service import (
    ALGORITMO,
    ENLACE_INVALIDO,
    ENLACE_VENCIDO,
    MENSAJE_SOLICITUD,
    MOTIVO_ARREPENTIMIENTO,
    PROPOSITO,
    crear_token,
)
from services.email_service import template_env
from services.payment_service import payment_service
from tests.test_cancelacion_reservas import EmailServiceFalso, MercadoPagoFalso

client = TestClient(app)

pytestmark = pytest.mark.usefixtures("camping_de_prueba")

MONTO = 15000.0
PERSONAS = 3


class CorreoFalso(EmailServiceFalso):
    def __init__(self):
        super().__init__()
        self.solicitudes = []

    def enviar_enlaces_arrepentimiento_sync(self, destinatario, datos):
        self.solicitudes.append({"destinatario": destinatario, **datos})


# ---------- Fixtures y helpers ----------

@pytest.fixture(autouse=True)
def configuracion(monkeypatch):
    """Los tests no dependen del valor que tenga cada .env."""
    monkeypatch.setattr(settings, "ARREPENTIMIENTO_DIAS", 10)
    monkeypatch.setattr(settings, "ARREPENTIMIENTO_TOKEN_MINUTOS", 60)
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://qamp.test")


@pytest.fixture
def mp(monkeypatch):
    falso = MercadoPagoFalso()
    monkeypatch.setattr(payment_service, "mp", falso)
    return falso


@pytest.fixture
def correo(monkeypatch):
    falso = CorreoFalso()
    monkeypatch.setattr("services.cancelacion_service.email_service", falso)
    monkeypatch.setattr("services.arrepentimiento_service.email_service", falso)
    return falso


@pytest.fixture
def reglas(configurar_camping):
    def _fijar(dias=1, porcentaje=100):
        configurar_camping(dias_cancelacion=dias, porcentaje_devolucion=porcentaje)
    _fijar()
    return _fijar


@pytest.fixture
def email():
    """Un email distinto por test, para no ver reservas de otros tests."""
    return f"arrepentimiento_{uuid.uuid4().hex[:10]}@grupo8.com"


@pytest.fixture
def crear_reserva():
    """Reserva de visitante (sin cuenta) pagada, con su pago aprobado. La borra al terminar."""
    creadas = []

    def _crear(
        email,
        dias_hasta_ingreso=5,
        dias_desde_reserva=0,
        estado_reserva=EstadoReservaEnum.CONFIRMADA,
        estado_pago=EstadoPagoEnum.PAGADO,
    ):
        ingreso = hoy_argentina() + timedelta(days=dias_hasta_ingreso)
        db = SessionLocal()
        try:
            reserva = Reserva(
                user_id=None,
                fecha_reserva=ahora_utc().replace(tzinfo=None) - timedelta(days=dias_desde_reserva),
                camping_id=settings.CAMPING_ID,
                fecha_ingreso=ingreso,
                fecha_egreso=ingreso + timedelta(days=2),
                cantidad_personas=PERSONAS,
                monto_total=MONTO,
                titular="Visitante Arrepentido",
                email=email,
                estado_reserva=estado_reserva,
                estado_pago=estado_pago,
            )
            db.add(reserva)
            db.flush()
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
            creadas.append(reserva.id)
            return reserva.id, payment_id
        finally:
            db.close()

    yield _crear

    db = SessionLocal()
    try:
        db.query(Pago).filter(Pago.reserva_id.in_(creadas)).delete(synchronize_session=False)
        db.query(Reserva).filter(Reserva.id.in_(creadas)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _reserva(reserva_id) -> Reserva:
    db = SessionLocal()
    try:
        return db.get(Reserva, reserva_id)
    finally:
        db.close()


def _token(reserva_id, minutos=None) -> str:
    return crear_token(_reserva(reserva_id), minutos=minutos)


def _token_del_enlace(enlace: str) -> str:
    return parse_qs(urlparse(enlace).query)["token"][0]


def _solicitar(email):
    return client.post("/arrepentimiento/solicitud", json={"email": email})


def _condiciones(token):
    return client.get("/arrepentimiento/condiciones", params={"token": token})


def _confirmar(token):
    return client.post("/arrepentimiento/confirmar", json={"token": token})


def _alterar_firma(token: str) -> str:
    cabecera, cuerpo, firma = token.split(".")
    # Un carácter del medio de la firma: cambia los bytes firmados, no solo los bits de relleno
    otro = "A" if firma[5] != "A" else "B"
    return f"{cabecera}.{cuerpo}.{firma[:5]}{otro}{firma[6:]}"


# ---------- Solicitud ----------

def test_email_sin_reservas_responde_lo_mismo_y_no_envia_correo(correo, email):
    response = _solicitar(email)

    assert response.status_code == 202
    assert response.json() == {"mensaje": MENSAJE_SOLICITUD}
    assert correo.solicitudes == []


def test_email_con_reservas_responde_exactamente_lo_mismo(correo, crear_reserva, email):
    crear_reserva(email)

    response = _solicitar(email)

    assert response.status_code == 202
    assert response.json() == {"mensaje": MENSAJE_SOLICITUD}
    assert len(correo.solicitudes) == 1


def test_email_invalido_responde_422(correo):
    assert _solicitar("no-es-un-email").status_code == 422
    assert correo.solicitudes == []


def test_email_con_dos_reservas_recibe_un_enlace_por_reserva(correo, crear_reserva, email):
    primera, _ = crear_reserva(email, dias_hasta_ingreso=3)
    segunda, _ = crear_reserva(email, dias_hasta_ingreso=8)

    # Mayúsculas y espacios no cambian el email
    _solicitar(f"  {email.upper()} ")

    assert len(correo.solicitudes) == 1
    enviado = correo.solicitudes[0]
    assert enviado["destinatario"] == email
    assert enviado["minutos"] == 60
    assert [r["reserva_id"] for r in enviado["reservas"]] == [str(primera), str(segunda)]
    detalle = enviado["reservas"][0]
    ingreso = hoy_argentina() + timedelta(days=3)
    assert detalle["fecha_ingreso"] == ingreso.strftime("%d/%m/%Y")
    assert detalle["fecha_egreso"] == (ingreso + timedelta(days=2)).strftime("%d/%m/%Y")
    assert detalle["cantidad_personas"] == PERSONAS
    assert detalle["monto"] == "$ 15.000,00"
    # Cada enlace va a la web y nombra solo su reserva
    for item in enviado["reservas"]:
        assert item["enlace"].startswith("https://qamp.test/cancelar-reserva?token=")
        datos = jwt.decode(
            _token_del_enlace(item["enlace"]), settings.ARREPENTIMIENTO_SECRET_KEY, algorithms=[ALGORITMO]
        )
        assert datos["sub"] == item["reserva_id"]
        assert datos["email"] == email
        assert datos["purpose"] == PROPOSITO


def test_la_solicitud_solo_lista_reservas_pagadas_y_proximas(correo, crear_reserva, email):
    proxima, _ = crear_reserva(email, dias_hasta_ingreso=0)
    crear_reserva(email, dias_hasta_ingreso=-1)
    crear_reserva(email, estado_reserva=EstadoReservaEnum.PENDIENTE, estado_pago=EstadoPagoEnum.PENDIENTE)
    crear_reserva(email, estado_reserva=EstadoReservaEnum.CANCELADA)
    crear_reserva(f"otro_{email}")

    _solicitar(email)

    assert [r["reserva_id"] for r in correo.solicitudes[0]["reservas"]] == [str(proxima)]


# ---------- Enlace válido ----------

def test_token_valido_devuelve_las_condiciones_de_la_reserva(correo, reglas, crear_reserva, email):
    reglas(dias=7, porcentaje=0)
    reserva_id, _ = crear_reserva(email, dias_hasta_ingreso=3)

    response = _condiciones(_token(reserva_id))

    assert response.status_code == 200, response.text
    assert response.json() == {
        "puede_cancelar": True,
        "dias_minimos": 7,
        "fecha_limite": (hoy_argentina() + timedelta(days=2)).isoformat(),
        "porcentaje_devolucion": 100,
        "monto_devolucion": MONTO,
        "mensaje": None,
        "arrepentimiento": True,
    }


def test_confirmar_cancela_solo_la_reserva_del_enlace(mp, correo, reglas, crear_reserva, email):
    cancelada, payment_id = crear_reserva(email, dias_hasta_ingreso=3)
    otra, _ = crear_reserva(email, dias_hasta_ingreso=8)

    response = _confirmar(_token(cancelada))

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["id"] == str(cancelada)
    assert data["estado_reserva"] == EstadoReservaEnum.CANCELADA.value
    assert data["codigo_gestion"] == str(cancelada)
    assert data["monto_devuelto"] == MONTO
    assert data["mensaje"] == "La reserva quedó cancelada. Te devolvimos $ 15.000,00 por Mercado Pago."
    assert mp.reembolsos == [(payment_id, None)]
    assert _reserva(cancelada).estado_reserva == EstadoReservaEnum.CANCELADA
    # La otra reserva del mismo email no cambia
    assert _reserva(otra).estado_reserva == EstadoReservaEnum.CONFIRMADA
    assert _reserva(otra).estado_pago == EstadoPagoEnum.PAGADO


def test_el_correo_de_cancelacion_informa_el_codigo_de_gestion(mp, correo, reglas, crear_reserva, email):
    reserva_id, _ = crear_reserva(email, dias_hasta_ingreso=3)

    _confirmar(_token(reserva_id))

    enviado = correo.cancelaciones[0]
    assert enviado["destinatario"] == email
    assert enviado["codigo_gestion"] == str(reserva_id)
    assert enviado["motivo_cancelacion"] == MOTIVO_ARREPENTIMIENTO
    html = template_env.get_template("cancelacion_reserva.html").render(**enviado)
    assert f"Código de gestión: <strong>{reserva_id}</strong>" in html


# ---------- Enlaces que no sirven ----------

def test_token_vencido_responde_401(mp, correo, reglas, crear_reserva, email):
    reserva_id, _ = crear_reserva(email)
    vencido = _token(reserva_id, minutos=-1)

    for response in (_condiciones(vencido), _confirmar(vencido)):
        assert response.status_code == 401
        assert response.json()["detail"] == ENLACE_VENCIDO
    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.CONFIRMADA
    assert mp.reembolsos == []


def test_token_con_la_firma_alterada_responde_401(mp, correo, reglas, crear_reserva, email):
    reserva_id, _ = crear_reserva(email)
    alterado = _alterar_firma(_token(reserva_id))

    for response in (_condiciones(alterado), _confirmar(alterado)):
        assert response.status_code == 401
        assert response.json()["detail"] == ENLACE_INVALIDO
    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.CONFIRMADA
    assert mp.reembolsos == []


def _firmar(payload, clave=None) -> str:
    return jwt.encode(payload, clave or settings.ARREPENTIMIENTO_SECRET_KEY, algorithm=ALGORITMO)


def _payload(reserva_id, email, **cambios) -> dict:
    payload = {
        "sub": str(reserva_id),
        "email": email,
        "purpose": PROPOSITO,
        "exp": ahora_utc() + timedelta(minutes=30),
    }
    payload.update(cambios)
    return payload


@pytest.mark.parametrize("caso", ["otra_clave", "otro_proposito", "otro_email", "reserva_inexistente", "sin_email"])
def test_tokens_que_no_corresponden_responden_401(mp, correo, reglas, crear_reserva, email, caso):
    reserva_id, _ = crear_reserva(email)
    tokens = {
        # Por ejemplo, un token de sesión: tiene otra clave
        "otra_clave": _firmar(_payload(reserva_id, email), clave=settings.AUTH_SECRET_KEY),
        "otro_proposito": _firmar(_payload(reserva_id, email, purpose="login")),
        # La reserva existe, pero el enlace se generó para otro email
        "otro_email": _firmar(_payload(reserva_id, f"otro_{email}")),
        "reserva_inexistente": _firmar(_payload(uuid.uuid4(), email)),
        "sin_email": _firmar({k: v for k, v in _payload(reserva_id, email).items() if k != "email"}),
    }

    response = _confirmar(tokens[caso])

    assert response.status_code == 401
    assert response.json()["detail"] == ENLACE_INVALIDO
    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.CONFIRMADA
    assert mp.reembolsos == []


def test_un_token_de_una_reserva_no_cancela_otra_del_mismo_email(mp, correo, reglas, crear_reserva, email):
    primera, _ = crear_reserva(email)
    segunda, _ = crear_reserva(email, dias_hasta_ingreso=8)
    # El cuerpo del token de la primera, cambiado para nombrar a la segunda sin volver a firmar
    cabecera, _, firma = _token(primera).split(".")
    _, cuerpo_segunda, _ = _token(segunda).split(".")

    response = _confirmar(f"{cabecera}.{cuerpo_segunda}.{firma}")

    assert response.status_code == 401
    assert response.json()["detail"] == ENLACE_INVALIDO
    assert _reserva(primera).estado_reserva == EstadoReservaEnum.CONFIRMADA
    assert _reserva(segunda).estado_reserva == EstadoReservaEnum.CONFIRMADA


def test_token_reutilizado_no_devuelve_el_dinero_dos_veces(mp, correo, reglas, crear_reserva, email):
    reserva_id, payment_id = crear_reserva(email, dias_hasta_ingreso=3)
    token = _token(reserva_id)

    primera = _confirmar(token)
    segunda = _confirmar(token)

    assert primera.status_code == 200
    assert segunda.status_code == 422
    assert segunda.json()["detail"] == "La reserva ya está cancelada."
    assert mp.reembolsos == [(payment_id, None)]
    assert len(correo.cancelaciones) == 1
    # El mismo enlace, al consultar, explica que ya está cancelada
    condiciones = _condiciones(token).json()
    assert (condiciones["puede_cancelar"], condiciones["mensaje"]) == (False, "La reserva ya está cancelada.")


def test_fuera_de_plazo_no_se_cancela(mp, correo, reglas, crear_reserva, email):
    reglas(dias=7, porcentaje=0)
    # Hecha hace 11 días: ya no rige el arrepentimiento, y por las reglas del camping está fuera de plazo
    reserva_id, _ = crear_reserva(email, dias_hasta_ingreso=3, dias_desde_reserva=11)
    token = _token(reserva_id)

    condiciones = _condiciones(token).json()
    response = _confirmar(token)

    assert (condiciones["puede_cancelar"], condiciones["arrepentimiento"]) == (False, False)
    assert response.status_code == 422
    assert response.json()["detail"] == "Lo sentimos, las reservas solo se pueden cancelar hasta 7 días antes del ingreso."
    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.CONFIRMADA
    assert mp.reembolsos == []


# ---------- Correos ----------

def test_el_correo_de_los_enlaces_muestra_cada_reserva_y_su_enlace(correo, crear_reserva, email):
    crear_reserva(email, dias_hasta_ingreso=3)
    crear_reserva(email, dias_hasta_ingreso=8)
    _solicitar(email)
    datos = {k: v for k, v in correo.solicitudes[0].items() if k != "destinatario"}

    html = template_env.get_template("arrepentimiento_enlaces.html").render(**datos)

    for item in datos["reservas"]:
        assert f"Reserva {item['reserva_id']}" in html
        # El enlace no tiene caracteres que Jinja escape (&, comillas, <, >)
        assert f'href="{item["enlace"]}"' in html
    assert "vencen en 60 minutos" in html


def test_el_correo_del_qr_incluye_el_enlace_al_boton_de_arrepentimiento(monkeypatch):
    monkeypatch.setattr(payment_module, "generar_token_qr", lambda reserva: "token-qr")
    reserva = Reserva(
        id=uuid.uuid4(),
        titular="Visitante",
        email="qr@grupo8.com",
        fecha_ingreso=date(2099, 1, 10),
        cantidad_personas=2,
    )
    background_tasks = BackgroundTasks()

    payment_module._programar_correo_con_qr(reserva, background_tasks)

    datos = background_tasks.tasks[0].kwargs["datos_reserva"]
    assert datos["url_arrepentimiento"] == "https://qamp.test/arrepentimiento"
    html = template_env.get_template("confirmacion_reserva.html").render(**datos)
    assert '<a href="https://qamp.test/arrepentimiento">Botón de arrepentimiento</a>' in html
