from models.configuracion import ConfiguracionCamping


def test_configuracion_camping_instanciacion():
    """
    Verifica que el modelo ConfiguracionCamping (definido pero sin tests
    previos) sea importable e instanciable con sus campos obligatorios.
    No se persiste en la BD; solo valida la definición del modelo.
    """
    config = ConfiguracionCamping(
        camping_id="CAMP-TEST-01",
        capacidad_total=50,
        porcentaje_buffer_offline=10,
        precio_base_actual=5000.0,
    )

    assert config.camping_id == "CAMP-TEST-01"
    assert config.capacidad_total == 50
    assert config.porcentaje_buffer_offline == 10
    assert config.precio_base_actual == 5000.0
    assert ConfiguracionCamping.__tablename__ == "configuracion_camping"