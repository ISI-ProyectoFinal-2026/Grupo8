import pytest
import resend

from core.database import Base, SessionLocal, engine
from models.user import User
from models.reserva import Reserva, ReservaPersona
from models.ingreso_fisico import IngresoFisico
from models.configuracion import ConfiguracionCamping
from models.conflictos import ConflictosSincronizacion
from services.camping_service import obtener_o_crear_camping
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
