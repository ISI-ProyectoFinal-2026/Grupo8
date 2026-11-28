"""Formulario de Contacto (Issue 31.5): POST /contacto envía el mensaje con Resend al correo del camping.

Resend está reemplazado por la fixture autouse `resend_falso` (conftest.py): ningún test envía correos."""
import logging

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from main import app
from services.contacto_service import (
    ERROR_ENVIO,
    ERROR_NO_CONFIGURADO,
    GLOBAL_MAXIMO,
    MENSAJE_ENVIADO,
    POR_IP_MAXIMO,
    LimiteDeEnvios,
    limite_de_envios,
)

client = TestClient(app)

URL = "/contacto"
DESTINO = "camping@ejemplo.com"
REMITENTE = "Camping <contacto@ejemplo.com>"
VALIDO = {
    "nombre": "Ana Pérez",
    "email": "ana@correo.com",
    "mensaje": "Hola, quería consultar si aceptan mascotas en el camping.",
}


@pytest.fixture(autouse=True)
def contacto_configurado(monkeypatch):
    """Destinatario y remitente de prueba, y el límite de envíos vacío en cada test."""
    monkeypatch.setattr(settings, "CONTACTO_EMAIL_DESTINO", DESTINO)
    monkeypatch.setattr(settings, "CONTACTO_EMAIL_REMITENTE", REMITENTE)
    monkeypatch.setattr(settings, "CONTACTO_IP_DESDE_PROXY", False)
    limite_de_envios.reiniciar()
    yield
    limite_de_envios.reiniciar()


def enviar(**cambios):
    return client.post(URL, json={**VALIDO, **cambios})


# ---------------------------------------------------------------- envío correcto


def test_envio_exitoso_con_datos_validos(resend_falso):
    response = enviar()

    assert response.status_code == 202
    assert response.json() == {"mensaje": MENSAJE_ENVIADO}
    assert len(resend_falso.enviados) == 1


def test_el_correo_lleva_los_datos_del_visitante_y_responde_a_el(resend_falso):
    enviar()

    params = resend_falso.enviados[0]
    assert params["from"] == REMITENTE
    assert params["reply_to"] == "ana@correo.com"
    assert "Ana Pérez" in params["subject"]
    assert "Ana Pérez" in params["html"]
    assert "ana@correo.com" in params["html"]
    assert "aceptan mascotas" in params["html"]


def test_el_destinatario_sale_de_la_configuracion_y_no_de_lo_que_manda_el_frontend(resend_falso):
    response = client.post(
        URL, json={**VALIDO, "destinatario": "otro@ajeno.com", "to": ["otro@ajeno.com"], "from": "x@ajeno.com"}
    )

    assert response.status_code == 202
    params = resend_falso.enviados[0]
    assert params["to"] == [DESTINO]
    assert params["from"] == REMITENTE


def test_el_contenido_del_visitante_se_escapa_en_el_html(resend_falso):
    enviar(mensaje="<script>alert('x')</script> y un mensaje largo")

    html = resend_falso.enviados[0]["html"]
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_acepta_el_largo_maximo_y_los_saltos_de_linea(resend_falso):
    assert enviar(mensaje="a" * 2000).status_code == 202
    assert enviar(mensaje="Primera línea\n\nSegunda línea").status_code == 202
    assert len(resend_falso.enviados) == 2


# ---------------------------------------------------------------- validaciones


@pytest.mark.parametrize(
    "campo, valor",
    [
        ("nombre", ""),
        ("nombre", "   "),
        ("nombre", "A"),
        ("nombre", "Ana123"),
        ("nombre", "Ana\nBcc: otro@ajeno.com"),
        ("nombre", "A" * 101),
        ("email", ""),
        ("email", "no-es-un-email"),
        ("email", "ana@"),
        ("email", "ana@correo.com\nBcc: otro@ajeno.com"),
        ("mensaje", ""),
        ("mensaje", "          "),
        ("mensaje", "corto"),
        ("mensaje", "a" * 2001),
        ("mensaje", "mensaje con un carácter de control \x00 adentro"),
    ],
)
def test_campos_invalidos_se_rechazan_sin_enviar(resend_falso, campo, valor):
    response = enviar(**{campo: valor})

    assert response.status_code == 422
    assert resend_falso.enviados == []


@pytest.mark.parametrize("campo", ["nombre", "email", "mensaje"])
def test_campo_ausente_se_rechaza_sin_enviar(resend_falso, campo):
    cuerpo = {k: v for k, v in VALIDO.items() if k != campo}

    response = client.post(URL, json=cuerpo)

    assert response.status_code == 422
    assert resend_falso.enviados == []


def test_los_espacios_de_los_bordes_se_ignoran(resend_falso):
    response = enviar(nombre="  Ana Pérez  ", mensaje="   Hola, quería hacer una consulta.   ")

    assert response.status_code == 202
    assert "Ana Pérez" in resend_falso.enviados[0]["subject"]


# ---------------------------------------------------------------- Resend falla


def test_si_resend_falla_no_se_informa_exito(resend_falso):
    resend_falso.error = RuntimeError("Resend caído")

    response = enviar()

    assert response.status_code == 502
    assert response.json() == {"detail": ERROR_ENVIO}
    assert "enviado" not in response.text.lower()
    assert "Resend caído" not in response.text


def test_si_resend_falla_no_se_filtra_la_clave_ni_en_la_respuesta_ni_en_los_logs(resend_falso, caplog):
    resend_falso.error = RuntimeError(f"401 clave inválida {settings.RESEND_API_KEY}")

    with caplog.at_level(logging.INFO):
        response = enviar()

    assert response.status_code == 502
    assert settings.RESEND_API_KEY not in response.text
    assert settings.RESEND_API_KEY not in caplog.text
    assert "Resend no pudo enviar el mensaje" in caplog.text


def test_la_clave_de_resend_no_aparece_en_las_respuestas_ni_en_openapi(resend_falso):
    exito = enviar()
    esquema = client.get("/openapi.json")

    assert settings.RESEND_API_KEY not in exito.text
    assert settings.RESEND_API_KEY not in esquema.text


def test_sin_destinatario_configurado_responde_503_y_no_envia(monkeypatch, resend_falso):
    monkeypatch.setattr(settings, "CONTACTO_EMAIL_DESTINO", "")

    response = enviar()

    assert response.status_code == 503
    assert response.json() == {"detail": ERROR_NO_CONFIGURADO}
    assert resend_falso.enviados == []


# ---------------------------------------------------------------- límite de envíos


def test_supera_el_limite_por_visitante_y_se_le_informa(resend_falso):
    for _ in range(POR_IP_MAXIMO):
        assert enviar().status_code == 202

    response = enviar()

    assert response.status_code == 429
    assert "Enviaste muchos mensajes" in response.json()["detail"]
    assert int(response.headers["Retry-After"]) > 0
    assert len(resend_falso.enviados) == POR_IP_MAXIMO


def test_los_mensajes_rechazados_por_validacion_no_gastan_el_limite(resend_falso):
    for _ in range(POR_IP_MAXIMO + 2):
        assert enviar(mensaje="corto").status_code == 422

    assert enviar().status_code == 202


def test_otro_visitante_no_queda_bloqueado_detras_de_un_proxy(monkeypatch, resend_falso):
    monkeypatch.setattr(settings, "CONTACTO_IP_DESDE_PROXY", True)
    for _ in range(POR_IP_MAXIMO):
        client.post(URL, json=VALIDO, headers={"X-Forwarded-For": "203.0.113.10"})

    bloqueado = client.post(URL, json=VALIDO, headers={"X-Forwarded-For": "203.0.113.10"})
    otro = client.post(URL, json=VALIDO, headers={"X-Forwarded-For": "203.0.113.20"})

    assert bloqueado.status_code == 429
    assert otro.status_code == 202


def test_detras_del_proxy_se_usa_la_ultima_ip_y_no_la_que_escribe_el_visitante(monkeypatch, resend_falso):
    monkeypatch.setattr(settings, "CONTACTO_IP_DESDE_PROXY", True)
    for i in range(POR_IP_MAXIMO):
        # El visitante inventa una IP distinta cada vez; el proxy agrega siempre la real al final
        client.post(URL, json=VALIDO, headers={"X-Forwarded-For": f"10.0.0.{i}, 203.0.113.10"})

    response = client.post(URL, json=VALIDO, headers={"X-Forwarded-For": "10.0.0.99, 203.0.113.10"})

    assert response.status_code == 429


def test_sin_proxy_se_ignora_x_forwarded_for(resend_falso):
    for i in range(POR_IP_MAXIMO):
        client.post(URL, json=VALIDO, headers={"X-Forwarded-For": f"10.0.0.{i}"})

    response = client.post(URL, json=VALIDO, headers={"X-Forwarded-For": "10.0.0.99"})

    assert response.status_code == 429


class RelojFalso:
    def __init__(self):
        self.ahora = 1000.0

    def __call__(self):
        return self.ahora


def test_el_limite_se_libera_cuando_pasa_la_ventana():
    reloj = RelojFalso()
    limite = LimiteDeEnvios(maximo=2, ventana=600, maximo_global=100, ventana_global=3600, reloj=reloj)

    assert limite.intentar("1.1.1.1") == 0
    assert limite.intentar("1.1.1.1") == 0
    espera = limite.intentar("1.1.1.1")
    assert 0 < espera <= 601
    reloj.ahora += 601

    assert limite.intentar("1.1.1.1") == 0


def test_el_tope_global_corta_aunque_cambie_la_ip():
    reloj = RelojFalso()
    limite = LimiteDeEnvios(maximo=100, ventana=600, maximo_global=3, ventana_global=3600, reloj=reloj)

    assert [limite.intentar(f"1.1.1.{i}") for i in range(3)] == [0, 0, 0]
    assert limite.intentar("2.2.2.2") > 0
    reloj.ahora += 3601
    assert limite.intentar("2.2.2.2") == 0


def test_los_limites_por_defecto_son_razonables():
    assert 1 <= POR_IP_MAXIMO < GLOBAL_MAXIMO
