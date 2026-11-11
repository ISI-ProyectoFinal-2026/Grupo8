from decimal import Decimal

import uuid

import pytest
import resend

from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.user import RoleEnum, User
from models.reserva import Reserva, ReservaPersona
from models.descuento import AplicaDescuentoEnum, Descuento
from models.ingreso_fisico import IngresoFisico
from models.configuracion import ConfiguracionCamping
from models.conflictos import ConflictosSincronizacion
from models.pago import Pago
from services import socio_service
from services.camping_service import configuracion_inicial, obtener_o_crear_camping
from services.pricing_service import PricingService
from services.qr_service import QRService, qr_service


@pytest.fixture(scope="session")
def camping_de_prueba():
    """Las reservas tienen FK al camping, así que tiene que existir en la BD de test.
    Lo piden solo los módulos que insertan reservas."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        return obtener_o_crear_camping(db).camping_id
    finally:
        db.close()

def _aplicar_configuracion(**valores) -> None:
    """Escribe directo en la base, sin pasar por las validaciones del panel (permite cupo 0)."""
    db = SessionLocal()
    try:
        camping = obtener_o_crear_camping(db)
        for campo, valor in valores.items():
            setattr(camping, campo, valor)
        db.commit()
    finally:
        db.close()


@pytest.fixture(scope="session", autouse=True)
def configuracion_del_env():
    """
    Autouse: durante los tests el camping usa los valores del .env (cupo, buffer y máximo por
    reserva), aunque en la base local el administrador los haya cambiado desde el panel.
    Al terminar la corrida se dejan como estaban.
    """
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        camping = obtener_o_crear_camping(db)
        previos = {campo: getattr(camping, campo) for campo in configuracion_inicial()}
    finally:
        db.close()
    _aplicar_configuracion(**configuracion_inicial())
    yield
    _aplicar_configuracion(**previos)


@pytest.fixture
def configurar_camping():
    """
    Cambia la configuración guardada solo durante el test y la devuelve a los valores
    del .env al terminar. Uso: configurar_camping(capacidad_total=100_000).
    """
    yield _aplicar_configuracion
    _aplicar_configuracion(**configuracion_inicial())


# Descuento de socio que usan los tests de precios (en porcentaje)
DESCUENTO_SOCIO_PRUEBA = 20


@pytest.fixture(autouse=True)
def descuentos_fijos(monkeypatch):
    """
    Autouse: los importes de los tests no dependen de lo que haya cargado en la tabla
    descuentos (en CI está vacía y en una base local la edita el administrador).
    Solo existe el descuento de socio; devuelve su porcentaje para armar los esperados.
    """
    socio = Descuento(
        codigo="socio",
        nombre="Descuento para socios",
        aplica_a=AplicaDescuentoEnum.socio,
        porcentaje=Decimal(DESCUENTO_SOCIO_PRUEBA),
        activo=True,
    )
    monkeypatch.setattr(PricingService, "_descuentos_activos", staticmethod(lambda db: [socio]))
    return DESCUENTO_SOCIO_PRUEBA


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "socios_reales: el test usa la verificación real de socios al crear reservas",
    )
    config.addinivalue_line(
        "markers",
        "firma_real: el test valida de verdad la firma x-signature de los avisos de Mercado Pago",
    )


@pytest.fixture(autouse=True)
def socios_sin_verificar(request, monkeypatch):
    """
    Autouse: al crear una reserva, las personas marcadas como socio se dan por válidas,
    así los tests de precios y reservas no tienen que dar de alta un socio por cada DNI.
    Los tests que prueban la verificación usan @pytest.mark.socios_reales.
    """
    if request.node.get_closest_marker("socios_reales"):
        return
    monkeypatch.setattr(socio_service, "verificar_personas_socias", lambda db, personas: None)


@pytest.fixture(autouse=True)
def avisos_mp_firmados(request, monkeypatch):
    """
    Autouse: los avisos que llegan al webhook se dan por firmados, así los tests del
    flujo de pago no tienen que calcular la firma de Mercado Pago en cada llamada.
    Los tests que prueban la firma usan @pytest.mark.firma_real.
    """
    if request.node.get_closest_marker("firma_real"):
        return
    monkeypatch.setattr("api.payments.aviso_autentico", lambda x_signature, x_request_id, data_id: True)


@pytest.fixture
def como_admin():
    """
    Hace que get_current_user devuelva un administrador (sin token) y deja todo como estaba al terminar.
    Es solo para tests que no prueban la autenticación; así el reemplazo no se filtra a los demás módulos.
    """
    previo = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: User(
        id=uuid.uuid4(), email="admin_test@grupo8.com", rol=RoleEnum.ADMIN
    )
    yield
    if previo is None:
        app.dependency_overrides.pop(get_current_user, None)
    else:
        app.dependency_overrides[get_current_user] = previo


@pytest.fixture
def como_guardia():
    """Igual que como_admin, pero con un usuario de seguridad (el que sincroniza ingresos)."""
    previo = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: User(
        id=uuid.uuid4(), email="guardia_test@grupo8.com", rol=RoleEnum.SEGURIDAD
    )
    yield
    if previo is None:
        app.dependency_overrides.pop(get_current_user, None)
    else:
        app.dependency_overrides[get_current_user] = previo


class ResendFalso:
    """Reemplaza resend.Emails.send: registra cada envío y nunca sale a la red."""

    def __init__(self):
        self.enviados = []   # el dict `params` de cada llamada a Emails.send
        self.error = None    # si se asigna una excepción, send() la lanza (tras registrar)
        self.efecto = None   # callable(params) opcional, se ejecuta dentro de send()

    def send(self, params, options=None):
        self.enviados.append(params)
        if self.efecto:
            self.efecto(params)
        if self.error:
            raise self.error
        return {"id": f"email-falso-{len(self.enviados)}"}


@pytest.fixture(autouse=True)
def resend_falso(monkeypatch):
    """
    Autouse: ningún test del backend puede enviar correos reales.
    EmailService llama a resend.Emails.send(params); se parchea ese mismo punto.
    """
    falso = ResendFalso()
    monkeypatch.setattr(resend.Emails, "send", falso.send)
    return falso


@pytest.fixture
def espia_qr(monkeypatch):
    """Registra cada QR generado (jwt recibido y PNG devuelto) sin alterar el comportamiento real."""
    original = QRService.generar_qr_desde_jwt
    llamadas = []

    def espia(jwt_token):
        png = original(jwt_token)
        llamadas.append({"jwt": jwt_token, "png": png})
        return png

    monkeypatch.setattr(qr_service, "generar_qr_desde_jwt", espia)
    return llamadas
