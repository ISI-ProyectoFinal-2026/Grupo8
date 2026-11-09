import random
import string
import uuid
from datetime import date, timedelta
from typing import Callable, Dict, Iterator, List, Optional, Set

import jwt
import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.user import RoleEnum, User
from schemas.reserva import hoy_argentina
from services.alta_socio_service import normalizar

Base.metadata.create_all(bind=engine)

client = TestClient(app)

URL = "/admin/socios"
PREFIJO_EMAIL = "busquedasocio_"


@pytest.fixture(autouse=True)
def sin_override_de_autenticacion() -> Iterator[None]:
    """Otros módulos reemplazan get_current_user; acá se usan tokens reales."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


def _token(user_id) -> str:
    return jwt.encode({"sub": str(user_id)}, settings.AUTH_SECRET_KEY, algorithm="HS256")


def _headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _dni() -> str:
    return str(uuid.uuid4().int)[:8]


def _palabra() -> str:
    """Una palabra al azar, para que cada test encuentre solo a sus socios aunque la base tenga otros."""
    return "".join(random.choices(string.ascii_lowercase, k=12))


@pytest.fixture(scope="module")
def tokens() -> Iterator[Dict[str, str]]:
    """Un usuario por rol, con su token. Al terminar el módulo se borra todo lo creado con el prefijo."""
    db = SessionLocal()
    ids = {}
    try:
        for rol in (RoleEnum.ADMIN, RoleEnum.SEGURIDAD, RoleEnum.CLIENTE):
            usuario = User(
                email=f"{PREFIJO_EMAIL}{uuid.uuid4().hex[:12]}@grupo8.com",
                password_hash="secreto",
                nombre=f"Usuario {rol.name}",
                dni=_dni(),
                rol=rol,
            )
            db.add(usuario)
            db.commit()
            db.refresh(usuario)
            ids[rol.name] = usuario.id
    finally:
        db.close()

    yield {rol: _token(user_id) for rol, user_id in ids.items()}

    db = SessionLocal()
    try:
        db.query(User).filter(User.email.like(f"{PREFIJO_EMAIL}%")).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def admin(tokens) -> Dict[str, str]:
    return _headers(tokens["ADMIN"])


VIGENTE = hoy_argentina() + timedelta(days=30)
VENCIDA = hoy_argentina() - timedelta(days=30)


@pytest.fixture
def crear_socio(tokens) -> Callable[..., User]:
    def _crear(
        nombre: str,
        vence: Optional[date] = VIGENTE,
        activo: bool = True,
        dni: Optional[str] = None,
        is_socio: bool = True,
    ) -> User:
        db = SessionLocal()
        try:
            usuario = User(
                email=f"{PREFIJO_EMAIL}{uuid.uuid4().hex[:12]}@grupo8.com",
                password_hash="secreto",
                nombre=nombre,
                dni=dni or _dni(),
                rol=RoleEnum.CLIENTE,
                is_socio=is_socio,
                membresia_vence=vence,
                activo=activo,
            )
            db.add(usuario)
            db.commit()
            db.refresh(usuario)
            return usuario
        finally:
            db.close()

    return _crear


def _listar(admin: Dict[str, str], **params) -> List[dict]:
    response = client.get(URL, params=params, headers=admin)
    assert response.status_code == 200, response.text
    return response.json()


def _ids(socios: List[dict]) -> Set[str]:
    return {s["id"] for s in socios}


@pytest.fixture
def padron(crear_socio) -> Dict[str, object]:
    """Un socio de cada estado, con la misma palabra en el nombre."""
    palabra = _palabra()
    return {
        "palabra": palabra,
        "vigente": crear_socio(f"Ana {palabra}", vence=VIGENTE),
        "vencida": crear_socio(f"Bruno {palabra}", vence=VENCIDA),
        "sin_fecha": crear_socio(f"Carla {palabra}", vence=None),
        "baja": crear_socio(f"Diego {palabra}", vence=VIGENTE, activo=False),
    }


def _ids_de(padron: Dict[str, object], *claves: str) -> Set[str]:
    return {str(padron[clave].id) for clave in claves}  # type: ignore[attr-defined]


# --- Permisos ---

def test_sin_token_responde_401():
    assert client.get(URL, params={"buscar": "ana", "estado": "vigente"}).status_code == 401


@pytest.mark.parametrize("rol", ["CLIENTE", "SEGURIDAD"])
def test_los_demas_roles_reciben_403(rol, tokens):
    response = client.get(URL, params={"buscar": "ana"}, headers=_headers(tokens[rol]))
    assert response.status_code == 403


# --- Sin parámetros ---

def test_sin_parametros_devuelve_todos_los_estados(admin, padron):
    ids = _ids(_listar(admin))
    assert _ids_de(padron, "vigente", "vencida", "sin_fecha", "baja") <= ids


@pytest.mark.parametrize("vacio", ["", "   "])
def test_una_busqueda_vacia_no_filtra(vacio, admin, padron):
    ids = _ids(_listar(admin, buscar=vacio))
    assert _ids_de(padron, "vigente", "vencida", "sin_fecha", "baja") <= ids


# --- Búsqueda por nombre ---

def test_busca_por_una_parte_del_nombre(admin, crear_socio):
    palabra = _palabra()
    socio = crear_socio(f"Ana {palabra}")
    assert _ids(_listar(admin, buscar=palabra[2:8])) >= {str(socio.id)}


def test_la_busqueda_no_distingue_mayusculas(admin, crear_socio):
    palabra = _palabra()
    socio = crear_socio(f"Ana {palabra}")
    assert str(socio.id) in _ids(_listar(admin, buscar=palabra.upper()))


@pytest.mark.parametrize(
    "guardado,buscado",
    [
        ("Núñez", "nunez"),
        ("Núñez", "NUÑEZ"),
        ("Núñez", "núñez"),
        ("Nunez", "Núñez"),
        ("ÁLVAREZ", "alvarez"),
        ("José", "JOSE"),
        ("Müller", "muller"),
        ("Gonçalves", "goncalves"),
    ],
)
def test_la_busqueda_no_distingue_acentos(guardado, buscado, admin, crear_socio):
    palabra = _palabra()
    socio = crear_socio(f"{guardado} {palabra}")

    ids = _ids(_listar(admin, buscar=f"{buscado} {palabra}"))

    assert str(socio.id) in ids


def test_cada_palabra_tiene_que_aparecer_sin_importar_el_orden(admin, crear_socio):
    palabra = _palabra()
    ana_maria = crear_socio(f"Ana María Pérez {palabra}")
    ana_lopez = crear_socio(f"Ana López {palabra}")

    ids = _ids(_listar(admin, buscar=f"perez ana {palabra}"))

    assert str(ana_maria.id) in ids
    assert str(ana_lopez.id) not in ids


def test_un_nombre_que_no_coincide_no_aparece(admin, crear_socio):
    palabra = _palabra()
    crear_socio(f"Ana {palabra}")
    assert _listar(admin, buscar=_palabra()) == []


@pytest.mark.parametrize("comodin", ["%", "_", "%%", "a%b"])
def test_los_comodines_de_sql_se_buscan_como_texto(comodin, admin, crear_socio):
    palabra = _palabra()
    # Si el comodín no se escapara, "palabra%" o "palabra_" encontrarían a "palabrax"
    crear_socio(f"{palabra}x Ana")
    resultado = _listar(admin, buscar=f"{palabra}{comodin}")
    assert resultado == []


def test_los_que_no_son_socios_no_aparecen_aunque_coincida_el_nombre(admin, crear_socio):
    palabra = _palabra()
    no_socio = crear_socio(f"Ana {palabra}", is_socio=False)
    assert str(no_socio.id) not in _ids(_listar(admin, buscar=palabra))


def test_el_resultado_sigue_ordenado_por_nombre(admin, crear_socio):
    palabra = _palabra()
    zeta = crear_socio(f"Zulema {palabra}")
    alfa = crear_socio(f"Abril {palabra}")

    ids = [s["id"] for s in _listar(admin, buscar=palabra)]

    assert ids == [str(alfa.id), str(zeta.id)]


# --- Búsqueda por DNI ---

def test_busca_por_dni_completo(admin, crear_socio):
    socio = crear_socio("Ana Pérez")
    assert [s["id"] for s in _listar(admin, buscar=socio.dni)] == [str(socio.id)]


def test_busca_por_el_comienzo_del_dni(admin, crear_socio):
    base = str(random.randint(1000, 9999))
    uno = crear_socio("Ana Pérez", dni=f"{base}1111")
    dos = crear_socio("Luis Pérez", dni=f"{base}2222")
    otro = crear_socio("Eva Pérez", dni=f"9{base}111")

    ids = _ids(_listar(admin, buscar=base))

    assert {str(uno.id), str(dos.id)} <= ids
    assert str(otro.id) not in ids


def test_el_dni_con_puntos_tambien_se_encuentra(admin, crear_socio):
    socio = crear_socio("Ana Pérez", dni="3" + _dni()[:7])
    con_puntos = f"{socio.dni[:2]}.{socio.dni[2:5]}.{socio.dni[5:]}"
    assert str(socio.id) in _ids(_listar(admin, buscar=con_puntos))


def test_un_dni_inexistente_no_devuelve_nada(admin):
    assert _listar(admin, buscar="00000001") == []


def test_una_busqueda_demasiado_larga_responde_422(admin):
    response = client.get(URL, params={"buscar": "a" * 101}, headers=admin)
    assert response.status_code == 422


# --- Filtro por estado ---

@pytest.mark.parametrize(
    "estado,esperados",
    [
        ("vigente", {"vigente"}),
        ("vencida", {"vencida", "sin_fecha"}),
        ("baja", {"baja"}),
    ],
)
def test_filtra_por_estado(estado, esperados, admin, padron):
    ids = _ids(_listar(admin, buscar=padron["palabra"], estado=estado))
    assert ids == _ids_de(padron, *esperados)


def test_cada_socio_aparece_en_un_solo_estado(admin, padron):
    por_estado = [_ids(_listar(admin, buscar=padron["palabra"], estado=e)) for e in ("vigente", "vencida", "baja")]
    todos = _ids(_listar(admin, buscar=padron["palabra"]))

    assert set().union(*por_estado) == todos
    assert sum(len(ids) for ids in por_estado) == len(todos)


def test_un_dado_de_baja_con_fecha_vigente_no_cuenta_como_vigente(admin, padron):
    vigentes = _ids(_listar(admin, buscar=padron["palabra"], estado="vigente"))
    assert str(padron["baja"].id) not in vigentes  # type: ignore[attr-defined]


def test_el_filtro_coincide_con_lo_que_informa_cada_socio(admin, padron):
    for socio in _listar(admin, buscar=padron["palabra"], estado="vigente"):
        assert socio["membresia_vigente"] is True and socio["activo"] is True
    for socio in _listar(admin, buscar=padron["palabra"], estado="vencida"):
        assert socio["membresia_vigente"] is False and socio["activo"] is True
    for socio in _listar(admin, buscar=padron["palabra"], estado="baja"):
        assert socio["activo"] is False


def test_el_dia_del_vencimiento_todavia_es_vigente(admin, crear_socio):
    palabra = _palabra()
    hoy = crear_socio(f"Ana {palabra}", vence=hoy_argentina())
    ayer = crear_socio(f"Luis {palabra}", vence=hoy_argentina() - timedelta(days=1))

    assert _ids(_listar(admin, buscar=palabra, estado="vigente")) == {str(hoy.id)}
    assert _ids(_listar(admin, buscar=palabra, estado="vencida")) == {str(ayer.id)}


def test_el_filtro_usa_la_fecha_de_argentina(admin, crear_socio, monkeypatch):
    palabra = _palabra()
    socio = crear_socio(f"Ana {palabra}", vence=date(2030, 6, 15))

    monkeypatch.setattr("services.alta_socio_service.hoy_argentina", lambda: date(2030, 6, 15))
    assert _ids(_listar(admin, buscar=palabra, estado="vigente")) == {str(socio.id)}

    monkeypatch.setattr("services.alta_socio_service.hoy_argentina", lambda: date(2030, 6, 16))
    assert _ids(_listar(admin, buscar=palabra, estado="vencida")) == {str(socio.id)}


@pytest.mark.parametrize("estado", ["VIGENTE", "activo", "todos", "1"])
def test_un_estado_desconocido_responde_422(estado, admin):
    response = client.get(URL, params={"estado": estado}, headers=admin)
    assert response.status_code == 422


# --- Combinaciones ---

@pytest.mark.parametrize(
    "estado,esperados",
    [
        (None, {"ana_vigente", "ana_vencida", "ana_baja"}),
        ("vigente", {"ana_vigente"}),
        ("vencida", {"ana_vencida"}),
        ("baja", {"ana_baja"}),
    ],
)
def test_buscar_por_nombre_y_filtrar_por_estado(estado, esperados, admin, crear_socio):
    palabra = _palabra()
    socios = {
        "ana_vigente": crear_socio(f"Ána {palabra}", vence=VIGENTE),
        "ana_vencida": crear_socio(f"ANA {palabra}", vence=VENCIDA),
        "ana_baja": crear_socio(f"ana {palabra}", activo=False),
        "luis_vigente": crear_socio(f"Luis {palabra}", vence=VIGENTE),
    }
    params = {"buscar": f"ana {palabra}"}
    if estado:
        params["estado"] = estado

    ids = _ids(_listar(admin, **params))

    assert ids == {str(socios[clave].id) for clave in esperados}


@pytest.mark.parametrize("estado,encontrado", [("vigente", False), ("vencida", False), ("baja", True)])
def test_buscar_por_dni_y_filtrar_por_estado(estado, encontrado, admin, crear_socio):
    socio = crear_socio("Ana Pérez", activo=False)
    ids = _ids(_listar(admin, buscar=socio.dni, estado=estado))
    assert (str(socio.id) in ids) is encontrado


def test_filtrar_por_estado_sin_buscar(admin, padron):
    ids = _ids(_listar(admin, estado="baja"))
    assert str(padron["baja"].id) in ids  # type: ignore[attr-defined]
    assert str(padron["vigente"].id) not in ids  # type: ignore[attr-defined]


# --- Normalización ---

@pytest.mark.parametrize(
    "texto,esperado",
    [("Núñez", "nunez"), ("ÁLVAREZ", "alvarez"), ("María José", "maria jose"), ("Gonçalves", "goncalves")],
)
def test_normalizar_quita_acentos_y_mayusculas(texto, esperado):
    assert normalizar(texto) == esperado
