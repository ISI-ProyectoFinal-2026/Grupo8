"""
Se ejecuta el EmailService real y se intercepta únicamente resend.Emails.send 
mediante la fixture `resend_falso` (tests/conftest.py). 
No requiere base de datos ni red.
"""
import io
import logging
import re

import pytest
import resend
from PIL import Image

from core.config import settings
from services.email_service import EmailService
from services.qr_service import qr_service

RESERVA_ID = "6cad7a24-0843-4326-bfd9-f909182b9d4a"
DATOS_RESERVA = {
    "reserva_id": RESERVA_ID,
    "nombre_cliente": "Ana Pérez",
    "email": "ana@test.com",
    "fecha_ingreso": "2030-06-10",
    "cantidad_personas": 4,
}
# Cadena con la forma y longitud de un JWT ES256 (~380 caracteres), sin valor criptográfico
JWT_DE_PRUEBA = ".".join(["h" * 36, "p" * 260, "s" * 86])
FIRMA_PNG = b"\x89PNG\r\n\x1a\n"


def _enviar(datos=None, jwt_token=JWT_DE_PRUEBA, destinatario="ana@test.com"):
    EmailService.enviar_confirmacion_sync(
        destinatario=destinatario,
        datos_reserva=datos if datos is not None else DATOS_RESERVA,
        jwt_token=jwt_token,
    )


def test_envia_un_unico_correo_al_destinatario_con_asunto_y_remitente(resend_falso):
    _enviar()

    assert len(resend_falso.enviados) == 1
    params = resend_falso.enviados[0]
    assert params["to"] == ["ana@test.com"]
    assert "confirmada" in params["subject"].lower()
    assert "@" in params["from"]


def test_el_html_incluye_los_datos_de_la_reserva_y_la_referencia_al_qr(resend_falso):
    _enviar()

    html = resend_falso.enviados[0]["html"]
    assert "Ana Pérez" in html
    assert RESERVA_ID in html
    assert "2030-06-10" in html
    assert re.search(r"Cantidad de Personas:</strong>\s*4", html)
    # La imagen inline apunta al mismo content_id del adjunto
    assert 'src="cid:qr_code"' in html


def test_adjunta_el_png_del_qr_generado_a_partir_del_jwt(resend_falso, espia_qr):
    _enviar()

    adjuntos = resend_falso.enviados[0]["attachments"]
    assert len(adjuntos) == 1
    adjunto = adjuntos[0]
    assert adjunto["filename"] == f"QR_Acceso_{RESERVA_ID}.png"
    assert adjunto["content_id"] == "qr_code"
    # El SDK de Resend en Python recibe el contenido como lista de enteros
    assert isinstance(adjunto["content"], list)

    png = bytes(adjunto["content"])
    assert png.startswith(FIRMA_PNG)
    imagen = Image.open(io.BytesIO(png))
    imagen.load()
    assert imagen.format == "PNG"
    assert imagen.width == imagen.height >= 100

    # Es exactamente el QR generado a partir del JWT recibido
    assert len(espia_qr) == 1
    assert espia_qr[0]["jwt"] == JWT_DE_PRUEBA
    assert png == espia_qr[0]["png"]


def test_jwt_distintos_producen_qr_distintos(resend_falso):
    _enviar(jwt_token=JWT_DE_PRUEBA)
    _enviar(jwt_token=JWT_DE_PRUEBA + "x")

    primero, segundo = (e["attachments"][0]["content"] for e in resend_falso.enviados)
    assert primero != segundo


def test_sin_reserva_id_el_adjunto_usa_el_nombre_por_defecto(resend_falso):
    datos = {k: v for k, v in DATOS_RESERVA.items() if k != "reserva_id"}

    _enviar(datos)

    assert resend_falso.enviados[0]["attachments"][0]["filename"] == "QR_Acceso_Qamp.png"


def test_escapa_el_html_de_los_datos_del_cliente(resend_falso):
    datos = {**DATOS_RESERVA, "nombre_cliente": "<script>alert(1)</script>"}

    _enviar(datos)

    html = resend_falso.enviados[0]["html"]
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_si_resend_falla_el_error_no_se_propaga_y_se_registra(resend_falso, caplog):
    resend_falso.error = RuntimeError("Resend caído")

    with caplog.at_level(logging.ERROR, logger="services.email_service"):
        _enviar()  # no debe lanzar: corre en un hilo secundario

    assert len(resend_falso.enviados) == 1
    assert "Error crítico en hilo secundario" in caplog.text


def test_si_falla_la_generacion_del_qr_no_se_llama_a_resend(monkeypatch, resend_falso, caplog):
    def qr_roto(jwt_token):
        raise ValueError("No se pudo generar la imagen del Código QR")

    monkeypatch.setattr(qr_service, "generar_qr_desde_jwt", qr_roto)

    with caplog.at_level(logging.ERROR, logger="services.email_service"):
        _enviar()

    assert resend_falso.enviados == []
    assert "Error crítico en hilo secundario" in caplog.text


def test_la_api_key_de_resend_sale_de_la_configuracion():
    assert resend.api_key == settings.RESEND_API_KEY
