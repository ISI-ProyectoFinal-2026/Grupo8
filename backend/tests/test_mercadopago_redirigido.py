from unittest.mock import patch

from services import payment_service
from services.payment_service import HttpClientRedirigido, _cliente_http_mercado_pago


def test_sin_url_de_pruebas_usa_el_cliente_normal():
    with patch.object(payment_service.settings, "MERCADOPAGO_API_URL", ""):
        assert _cliente_http_mercado_pago() is None


def test_en_produccion_nunca_se_redirige():
    with (
        patch.object(payment_service.settings, "MERCADOPAGO_API_URL", "http://localhost:8090"),
        patch.object(payment_service.settings, "ENVIRONMENT", "production"),
    ):
        assert _cliente_http_mercado_pago() is None


def test_en_pruebas_e2e_cambia_solo_la_direccion_base():
    cliente = HttpClientRedirigido("http://localhost:8090/")
    with patch("mercadopago.http.http_client.HttpClient.request", return_value={"status": 200}) as original:
        cliente.get(url="https://api.mercadopago.com/v1/payments/123", headers={})

    assert original.call_args.args[1] == "http://localhost:8090/v1/payments/123"
