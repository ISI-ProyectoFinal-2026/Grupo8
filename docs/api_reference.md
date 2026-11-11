# Referencia de la API 

Esta documentación detalla los esquemas de datos, modelos de persistencia relacional y las interfaces HTTP (Endpoints) expuestas por el backend construido sobre FastAPI.

## 1. Modelos de Base de Datos (SQLAlchemy)

El sistema utiliza SQLAlchemy como ORM, mapeando clases Python a tablas en PostgreSQL. Todos los modelos heredan de una base declarativa común (`core.database.Base`).

* **Modelo de Usuario (`User`)**
* **Tabla:** `usuarios`
* **Campos Principales:** ID (`UUID` como identificador único), correo electrónico único, hash de contraseña, DNI.
* **Lógica de Negocio:** Atributo de membresía `is_socio`, estado de cuota y rol del sistema configurado mediante `RoleEnum` (Admin, Seguridad, Cliente).
* **Auditoría:** Marcas de tiempo `created_at` y `updated_at`.
* **Modelo de Reserva (`Reserva`)**
* **Tabla:** `reservas`
* **Campos Principales:** ID (`UUID`), `user_id` (clave foránea a usuarios; es nulo cuando la reserva se hizo sin iniciar sesión), `tipo_reserva_id` (clave foránea a `tipos_reserva`; nula en las reservas anteriores a la Issue 19), fecha y hora de la reserva, cantidad de personas.
* **Lógica de Negocio:** Estado de pago manejado por `EstadoPagoEnum` (Pendiente, Pagado, Cancelado).
* **Seguridad:** Identificador único para códigos QR (`jwt_jti`).
* **Modelo de Tipo de Reserva (`TipoReserva`)**
* **Tabla:** `tipos_reserva`
* **Campos Principales:** ID (`UUID`), `nombre` (único sin distinguir mayúsculas), `precio` (`Numeric(10, 2)`, mayor a 0), `forma_cobro` (`FormaCobroEnum`: `POR_PERSONA` o `POR_UNIDAD`), `max_personas` (máximo de personas de una reserva de ese tipo), `cantidad_unidades` (unidades por noche; vacío = sin límite, y siempre vacío en los tipos por persona) y `activo`.
* **Lógica de Negocio:** No se borran: se desactivan. La clave foránea desde `reservas` es `RESTRICT`, así que un tipo con reservas no se puede eliminar. La migración crea Entrada general y Carpa (por persona, $5.000) y Cabaña (por unidad, $25.000, 6 personas, 4 unidades).
* **Modelo de Personas de la Reserva (`ReservaPersona`)**
* **Tabla:** `reserva_personas`
* **Campos Principales:** ID (`UUID`), `reserva_id` (clave foránea a reservas, con borrado en cascada), `orden` (la posición 0 es el titular), `nombre`, `edad`, `condicion` (`visitante` o `socio`) y `dni`.
* **Precio:** Cada fila guarda una foto del cobro al momento de reservar (`precio_base`, `descuento_pct`, `precio_final`), por lo que cambios posteriores en tarifas o descuentos no alteran reservas ya creadas.
* **Restricciones:** El DNI no puede repetirse dentro de la misma reserva, la edad va de 0 a 120 y el descuento de 0 a 100 %. Las reservas creadas antes de esta tabla no tienen personas guardadas.
* **Modelo de Descuentos (`Descuento`)**
* **Tabla:** `descuentos`
* **Campos Principales:** ID (`UUID`), `codigo` (único y fijo, ej. `socio`), `nombre`, `aplica_a` (`socio` o `edad`), `porcentaje` (0 a 100, hasta 2 decimales), `edad_min` y `edad_max` (inclusivos, solo en los descuentos por edad) y `activo`.
* **Valor inicial:** La migración crea el descuento `socio` con el porcentaje que hasta ahora estaba en `PORCENTAJE_DESCUENTO_SOCIO`; esa variable deja de usarse como fuente del descuento y el resto lo define el administrador.
* **Restricciones:** Un descuento para socios no lleva límites de edad; uno por edad necesita los dos y `edad_min <= edad_max` (entre 0 y 120). Los descuentos no se borran: se desactivan.
* **Reservas anteriores:** Las reservas guardan su propia copia del porcentaje y del precio (`reserva_personas`), por lo que modificar un descuento no cambia reservas ya creadas.
* **Modelo de Ingresos Físicos (`IngresoFisico`)**
* **Campos Principales:** `reserva_id`, `fecha_hora_ingreso`, `tipo_ingreso` (ej. WEB), `sincronizado_offline` (Booleano que permite métricas analíticas).
* **Personas:** `cantidad_personas` guarda cuántas personas entraron con ese ingreso (la que trae el QR o la que anota el guardia). Los ingresos anteriores a la Issue 16 no la tienen y cuentan como 1 persona a través de la propiedad `personas`, que también sirve en consultas (`func.sum(IngresoFisico.personas)`).
* **Modelo de Egresos Físicos (`EgresoFisico`)**
* **Tabla:** `egresos_fisicos`
* **Campos Principales:** ID (`UUID`), `cantidad_personas` (al menos 1, con restricción en la base), `fecha_hora_egreso` (`timestamptz`, en UTC) y `registrado_por_id` (administrador que lo cargó).
* **Uso:** Registra las salidas del camping. Junto con los ingresos permite calcular cuántas personas hay dentro.
* **Modelo de Conflictos de Sincronización (`ConflictosSincronizacion`)**
* **Campos Principales:** ID (`UUID`), `reserva_id` (`UUID`), `jti_involucrado`, `motivo`, `fecha_registro`.
* **Uso:** Tabla de auditoría para derivar reservas que presentan colisiones de concurrencia o duplicidad durante el escaneo offline.


## 2. Esquemas de Validación y Transferencia (Pydantic)

FastAPI utiliza Pydantic para garantizar la serialización y validación estricta de todos los *payloads* de entrada y salida, con mensajes de error normalizados en español.

* **`ReservaCreate` (Payload de Entrada)**
* **Personas (`personas`):** Lista de `PersonaReserva` con al menos 1 elemento y como máximo `max_personas_por_reserva` de la configuración del camping (10 por defecto). El máximo lo controla el endpoint, porque sale de la base: si se supera, responde 422 con `detail` en texto. La cantidad de personas de la reserva es el largo de la lista y el titular es la primera persona. Excepción: en las reservas por unidad (Issue 19.3) no se envía `personas`, sino `titular` y `cantidad_personas`.
* **`PersonaReserva`:** `nombre` (2 a 100 caracteres, solo letras, espacios, puntos, apóstrofes y guiones), `edad` (entero estricto entre 0 y 120), `condicion` (`visitante` o `socio`) y `dni` (7 u 8 dígitos; obligatorio para socios y sin repetirse dentro de la reserva).
* **Fechas:** Formato AAAA-MM-DD. El sistema valida que el ingreso no sea anterior a "hoy" (hora de Argentina), el egreso no sea anterior al ingreso y la estadía no supere `MAX_NOCHES_POR_RESERVA` (10).
* **Email:** Validado mediante `EmailStr` empleando la dependencia `email-validator`.
* **Teléfono:** Ya no se pide ni se valida al crear una reserva. Si un cliente anterior lo envía, se ignora y no se guarda.
* **`ReservaResponse` (Payload de Salida)**
* Esquema dedicado al formateo seguro de los datos de la reserva hacia el frontend, omitiendo datos sensibles internos.
* Incluye `telefono` solo para las reservas anteriores que lo tienen guardado (las nuevas lo devuelven en `null`; la columna se conserva para poder seguir leyéndolas).
* Incluye `personas` (lista de `PersonaOut`: nombre, edad, condición, DNI, precio base, porcentaje de descuento y precio final). Las reservas anteriores a la tabla de personas devuelven una lista vacía.
* **`CotizarRequest` / `CotizarResponse`**
* **Request:** `personas`, con al menos 1 elemento y como máximo `max_personas_por_reserva` de la configuración del camping, de `PersonaCotizar`: `edad` (entero estricto entre 0 y 120) y `condicion` (`visitante` o `socio`). No se envía ningún importe: el sistema ignora cualquier precio que mande el cliente.
* **Response:** `moneda` (`ARS`), `subtotal`, `descuento_total`, `total`, `cantidad_socios` y `detalle` (por persona: `indice`, `condicion_efectiva`, `descuento_codigo`, `descuento_pct`, `precio_base` y `precio_final`). Los importes salen con dos decimales.
* **`DescuentoCreate` / `DescuentoUpdate` / `DescuentoOut`**
* **Alta:** `codigo` (2 a 30 caracteres: minúsculas, números y guion bajo, empezando con una letra), `nombre` (2 a 100), `aplica_a`, `porcentaje` (número entre 0 y 100 con hasta 2 decimales), `edad_min` y `edad_max` (enteros entre 0 y 120, solo para `edad`) y `activo` (verdadero por defecto).
* **Modificación:** Se puede cambiar `nombre`, `porcentaje`, `edad_min`, `edad_max` y `activo`, enviando solo los campos a modificar. El `codigo` y `aplica_a` no se pueden cambiar.
* **`JWTPayloadSchema` (Contrato Criptográfico QR)**
* **Campos:** `jti` (UUID del token), `reserva_id` (Entero/UUID), `camping_id` (Entero), `typ` (Clasificación: `socio` o `visitante`), `cantidad_personas` (Entero), `iat` (Issued At), `exp` (Expiration Time) y `dat` (Fecha de la reserva). Este esquema es compartido exactamente con la interfaz `IJwtPayload` de TypeScript.
* **Qué significa `typ` en una reserva con socios y visitantes:** El QR es uno solo por reserva, no uno por persona, y `typ` no describe al titular ni a cada acompañante. Hoy se calcula al confirmar el pago a partir de la cuenta que hizo la reserva (`socio` si esa cuenta es socia; `visitante` si no lo es o si la reserva se hizo sin cuenta). Por eso, en una reserva mixta, la cantidad de socios no sale de `typ` sino de las personas de la reserva (`cantidad_socios` en `GET /reservas/mias`). El contrato del Sprint 4 (D4 y §4.4) reemplaza esto por un único `typ: "reserva"` con `cantidad_personas` y `cantidad_socios`; ese cambio de generación del QR y de la PWA no forma parte de la Issue 14.5. Los QR ya emitidos siguen siendo válidos.


## 3. Endpoints de Negocio y Reservas

Estos endpoints estructuran la operación principal del sistema de reservas y su seguridad de acceso.

* **`POST /reservas/cotizar`**
* **Descripción:** Calcula cuánto cuesta una reserva sin guardarla, para que el frontend muestre el total sin hacer cuentas propias. Es público (no pide sesión).
* **Cálculo:** Cada persona paga el precio base (`PRECIO_BASE_POR_PERSONA`) menos el mayor de los descuentos activos que le corresponden: el de socio si su condición es `socio` y los de edad cuyo rango incluye su edad. Los descuentos no se acumulan. El precio de cada persona se redondea a dos decimales (mitad hacia arriba) y el total es la suma de esos precios.
* **Tipo de reserva (Issue 19.3):** `tipo_reserva_id` es opcional mientras la web no lo envíe; sin tipo se cotiza como siempre, con `PRECIO_BASE_POR_PERSONA`.
  * **Tipo por persona:** se envían `personas` y el precio base de cada una es el precio del tipo, con los mismos descuentos. No se multiplica por las noches.
  * **Tipo por unidad:** se envían `cantidad_personas`, `fecha_ingreso` y `fecha_egreso` (sin `personas`). Total = precio de la unidad × noches (egreso − ingreso, al menos una), sin descuentos; `detalle` va vacío.
  * La respuesta suma `forma_cobro`, `precio_unitario` y `noches` (este último solo por unidad). No controla la disponibilidad de unidades.
  * Devuelve 422 si el tipo no existe o está desactivado, o si se supera el máximo de personas del tipo o el máximo general.
* **Manejo de Errores:** Devuelve 422 si no hay personas, hay más del máximo o alguna edad o condición es inválida.
* **`POST /reservas`**
* **Descripción:** Crea una nueva reserva inyectando datos a través de `ReservaCreate`. Funciona con o sin sesión: no recibe `user_id`. Si el pedido trae un token válido, la reserva queda asociada al usuario de ese token; sin token se crea igual y `user_id` queda nulo. Un `user_id` enviado en el cuerpo se ignora.
* **Sesión opcional:** Usa `get_current_user_optional` (`core/auth_opcional.py`). Con un token inválido o vencido responde 401 (no se trata como visitante) para que el frontend sepa que debe volver a iniciar sesión.
* **Cupo:** Las reservas canceladas y las pendientes con el plazo de pago vencido (más antiguas que `RESERVA_PENDIENTE_TTL_MINUTES`, 10 minutos por defecto) no ocupan cupo; las pendientes dentro del plazo sí, para evitar la sobreventa mientras se espera el pago.
* **Plazo de pago:** La respuesta incluye `vencimiento_pago` (UTC, con zona horaria): hasta cuándo se puede pagar. Es `null` en las reservas que no están pendientes. Las pendientes vencidas pasan a `CANCELADA` al crear y al consultar reservas (`POST /reservas`, `GET /reservas/mias`, `GET /reservas`), sin tarea programada.
* **Tipo de reserva (Issue 19.3):** `tipo_reserva_id` es opcional por ahora; sin tipo, la reserva funciona como antes y `tipo_reserva_id` y `precio_tipo` quedan nulos. Con tipo, la reserva guarda `tipo_reserva_id` y `precio_tipo` (el precio del tipo en ese momento).
  * **Por persona:** igual que siempre (todas las personas, DNI de socios, descuentos), con el precio del tipo como precio base.
  * **Por unidad:** se envían `titular` y `cantidad_personas` en lugar de `personas`; no se guardan filas de personas. `monto_total` = precio de la unidad × noches, sin descuentos. Se exige al menos una noche.
  * **Unidades:** se cuentan noche por noche (una reserva del 10 al 12 ocupa las noches del 10 y del 11). Cuentan las confirmadas, finalizadas, en alerta y las pendientes dentro del plazo de pago. Si en alguna noche están todas ocupadas, devuelve 409. Sin `cantidad_unidades` no hay límite. La fila del tipo se bloquea hasta el commit, para que dos pedidos simultáneos no se lleven la última unidad.
  * **Capacidad:** las personas de una reserva por unidad cuentan para la capacidad total del camping como cualquier otra.
* **Manejo de Errores:** Devuelve código HTTP 400 si la petición supera el límite máximo calculado por `capacity_service.py`, 409 si no quedan unidades del tipo, o 422 si la validación falla (datos mal formados, tipo inexistente o desactivado, datos que no corresponden a la forma de cobro, o más personas que el máximo del tipo o el máximo general).
* **Lógica Interna:** Acciona `PricingService.cotizar`, la misma función que usa `POST /reservas/cotizar`, con los descuentos activos de la tabla `descuentos`; por eso el `monto_total` es igual al total cotizado con las mismas personas. La reserva y todas sus personas se guardan en la misma transacción: si falla alguna, no se crea nada.
* **`GET /reservas/mias`**
* **Descripción:** Devuelve solo las reservas del usuario autenticado (`ReservaDetalle[]`), ordenadas por fecha de ingreso descendente. Incluye las personas de cada reserva y `cantidad_socios` (cuántas personas tienen condición `socio`).
* **Seguridad:** Exige sesión (401 sin token o con token inválido). El usuario sale del token; no existe ningún parámetro para pedir las reservas de otro. Las reservas hechas sin cuenta no aparecen en ningún listado personal.
* **`GET /reservas/`**
* **Seguridad:** Ruta crítica blindada mediante RBAC y `OAuth2PasswordBearer`.
* **Dependencias:** Exige autenticación válida mediante `get_current_user` y permisos exclusivos autorizados por `require_role` (Administrador).
* **`/admin/descuentos`** (solo `ADMIN`: sin token devuelve 401 y con otro rol, 403)
* **`GET /admin/descuentos`:** Lista todos los descuentos, activos e inactivos.
* **`POST /admin/descuentos`:** Crea un descuento (201). Devuelve 409 si el código ya existe y 422 si algún valor es inválido.
* **`PUT /admin/descuentos/{id}`:** Modifica un descuento. Devuelve 404 si no existe y 422 si algún valor es inválido o los límites de edad quedan incoherentes. No hay endpoint para borrar.
* **`GET /usuarios/prueba`**
* **Descripción:** Endpoint auxiliar solo para desarrollo. Retorna un identificador de usuario válido para pruebas manuales (por ejemplo, armar un token y llamar a `GET /reservas/mias`). El frontend no lo usa: reservar no necesita `user_id`.
* **Seguridad:** Queda automáticamente deshabilitado si la variable `ENVIRONMENT` es igual a `production`.


## 4. Endpoints de Sincronización Offline

Rutas operativas que soportan el comportamiento *offline-first* de la Progressive Web App en la barrera de acceso.

### `GET /api/v1/sincronizacion/bootstrap`

* **Tag:** Sincronización Offline.
* **Descripción:** Entrega la configuración inicial y la lista negra paginada requerida para que los dispositivos móviles operen sin internet.
* **Parámetros Query:** `page` (default: 1), `limit` (default: 1000).
* **Respuesta Exitosa (200 OK):**
```json
{
  "blacklist": ["1234", "5678", "9999"],
  "configuracion": {
    "capacidad_maxima": 50,
    "buffer_seguridad": 5
  },
  "clave_publica": "<clave pública de verificación ES256>",
  "pagina_actual": 1,
  "tiene_mas_paginas": false
}

```

(Nota: `blacklist` extrae los identificadores cancelados en las últimas 72 horas).

`capacidad_maxima` y `buffer_seguridad` salen de la configuración del camping guardada desde el panel. El buffer se envía en personas: el porcentaje de la capacidad redondeado hacia arriba.


### `POST /api/v1/ingresos/bulk-sync`

* **Tag:** Ingresos y Sincronización.
* **Seguridad:** Requiere el JWT de sesión de un usuario con rol `SEGURIDAD` (Header: `Authorization: Bearer <token>`). Emite código 401 si no hay un token válido o está vencido, y 403 si el usuario tiene otro rol (incluido `ADMIN`). En ambos casos no se procesa el lote.
* **Descripción:** Recibe en lote los ingresos registrados por la PWA sin conexión. Procesa el arreglo verificando cada reserva, detectando duplicidades y efectuando un *commit* único.
* **Request Body (`SyncIngresosRequest`):** Cada ingreso es de tipo `QR` o `MANUAL`. Los dos llevan `cantidad_personas`: en un QR es la que trae su payload (si un registro viejo de la cola no la trae, se guarda 1) y en uno manual es la que anota el guardia, junto con el monto cobrado.
```json
{
  "ingresos": [
    {
      "tipo_ingreso": "QR",
      "jti": "abc-123",
      "reserva_id": "3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b",
      "fecha_escaneo": "2026-10-03T14:22:05Z",
      "cantidad_personas": 4,
      "dispositivo_id": "dispositivo-A"
    },
    {
      "tipo_ingreso": "MANUAL",
      "jti": "manual-7c1d…",
      "fecha_escaneo": "2026-10-03T14:25:00Z",
      "cantidad_personas": 2,
      "monto_cobrado": 4500.50,
      "nombre": "Visitante Efectivo",
      "dni": "30123456",
      "dispositivo_id": "dispositivo-A"
    }
  ]
}

```

* **Respuesta Exitosa (200 OK):**
```json
{
  "procesados": 2,
  "conflictos": 0,
  "sincronizados_jti": ["abc-123", "manual-7c1d…"],
  "errores": []
}

```

Un registro inválido va a `errores` (`indice`, `jti`, `motivo`) y no frena el resto del lote.

* **Manejo de Errores:** Retorna HTTP 500 realizando un *rollback* de todo el lote ante un fallo crítico en la base de datos.


## 5. Endpoints del Panel: Ocupación, Configuración, Tipos de Reserva, Egresos y Cobros

Todos son solo para `ADMIN`: sin token devuelven 401 y con otro rol, 403. Las horas se guardan en UTC y los días se cuentan con la hora de Buenos Aires (ver `zonas-horarias.md`).

### `GET /api/v1/ocupacion`

* **Descripción:** Personas dentro del camping, capacidad máxima y buffer offline. Lo consume el monitor del inicio del panel.
* **Cálculo:** Personas de todos los ingresos aceptados menos personas egresadas. Cuenta todos los movimientos y no solo los del día, porque hay estadías de varias noches. Nunca es negativa.
* **Qué no suma:** Los QR clonados, que quedan en `conflictos_sincronizacion` y nunca llegan a `ingresos_fisicos`.
* **Capacidad y buffer:** Salen de la configuración del camping (`GET/PUT /api/v1/admin/configuracion`). `buffer_offline` se informa en personas: el porcentaje de la capacidad redondeado hacia arriba.
* **Atraso:** Los ingresos que el guardia registra sin conexión se cuentan recién cuando la PWA los sincroniza.
```json
{ "ocupacion_actual": 32, "capacidad_maxima": 50, "buffer_offline": 5 }
```

### `GET /api/v1/admin/configuracion`

* **Descripción:** Cupo máximo del camping, porcentaje de buffer offline y máximo de personas por reserva, tal como están guardados en `configuracion_camping`. Si la fila no existe, se crea con los valores del `.env`.
* **Respuesta Exitosa (200 OK):**
```json
{ "capacidad_total": 50, "porcentaje_buffer_offline": 10, "max_personas_por_reserva": 10, "porcentaje_buffer_recomendado": 10 }
```
* `porcentaje_buffer_recomendado` es la sugerencia que muestra el formulario (10 %, que equivale a 5 lugares sobre 50); no se guarda.

### `PUT /api/v1/admin/configuracion`

* **Descripción:** Guarda los tres valores juntos. Las reservas ya hechas no se modifican: si el cupo baja por debajo de lo reservado, se deja de vender hasta que se libere lugar.
* **Request Body (`ConfiguracionUpdate`):** `capacidad_total` (entero estricto entre 1 y 1.000.000), `porcentaje_buffer_offline` (entero estricto entre 0 y 100) y `max_personas_por_reserva` (entero estricto mayor a 0, que no supere el cupo online).
* **Cupo online:** `capacidad_total` menos el buffer en personas (`porcentaje × capacidad / 100`, redondeado hacia arriba). Es lo que se puede vender por la web; el resto queda para la puerta.
* **Errores:** 422 si algún valor es inválido o falta (no se guarda nada).
* **Respuesta Exitosa (200 OK):** La configuración guardada, con el mismo formato del `GET`.

### `GET /api/v1/tipos-reserva`

* **Descripción:** Público, sin sesión. Lista los tipos de reserva activos, ordenados por precio y nombre.
* **Respuesta Exitosa (200 OK):**
```json
[{ "id": "uuid", "nombre": "Cabaña", "precio": 25000.0, "forma_cobro": "POR_UNIDAD", "max_personas": 6, "cantidad_unidades": 4 }]
```

### `GET /api/v1/admin/tipos-reserva`

* **Descripción:** Solo ADMIN. Lista todos los tipos, incluidos los desactivados, con el campo `activo`.

### `POST /api/v1/admin/tipos-reserva`

* **Descripción:** Solo ADMIN. Crea un tipo (`201 Created`).
* **Request Body (`TipoReservaCreate`):** `nombre` (2 a 80 caracteres), `precio` (número mayor a 0, hasta 2 decimales), `forma_cobro`, `max_personas` (entero estricto mayor a 0, que no supere el máximo general por reserva), `cantidad_unidades` (opcional; entero ≥ 1, solo en tipos por unidad) y `activo` (por defecto `true`).
* **Errores:** 409 si el nombre ya existe (sin distinguir mayúsculas), 422 si algún dato es inválido.

### `PUT /api/v1/admin/tipos-reserva/{id}`

* **Descripción:** Solo ADMIN. Modificación parcial: solo cambian los campos enviados. Desactivar es enviar `{"activo": false}`; las reservas que ya usan el tipo no se modifican. `cantidad_unidades: null` deja el tipo sin límite de unidades.
* **Errores:** 404 si el tipo no existe, 409 por nombre repetido, 422 si los datos son inválidos o si la forma de cobro y las unidades quedan incoherentes (un tipo por persona no lleva unidades).
* No hay endpoint para borrar.

### `POST /api/v1/egresos`

* **Descripción:** Registra una salida del camping.
* **Request Body (`EgresoCreate`):** `cantidad_personas` (entero, al menos 1) y `fecha_hora_egreso` (opcional, ISO 8601 con zona; si no se manda, se usa la hora en que llega el pedido).
* **Respuesta (201 Created):** El egreso guardado y `personas_dentro`, las personas que quedan después de registrarlo.
* **Manejo de Errores:**
  * 422 si la cantidad es menor a 1, si la hora no trae zona horaria o si está en el futuro (con 5 minutos de margen).
  * 409 si se quiere egresar más gente de la que hay dentro; el mensaje indica cuántas personas hay.
* **Concurrencia:** Un candado de PostgreSQL (`pg_advisory_xact_lock`) evita que dos egresos simultáneos se validen contra la misma ocupación.

### `GET /api/v1/admin/cobros`

* **Descripción:** Lo cobrado por día, separado en efectivo y Mercado Pago, con los totales del período.
* **Parámetros Query:** `desde` y `hasta` (AAAA-MM-DD, ambos incluidos). Sin fechas devuelve la última semana, contando hoy. El rango máximo es de 92 días; un rango invertido o más largo devuelve 422.
* **Efectivo:** `monto_cobrado` de los ingresos manuales, en el día en que se escaneó el ingreso.
* **Mercado Pago:** Solo pagos de la tabla `pagos` con estado `approved`, en el día de la aprobación (o el de creación, si no hay fecha de aprobación). Si un pago se reembolsa, cambia de estado y deja de contarse.
* **Respuesta (200 OK):** Incluye todos los días del rango, también los que no tuvieron cobros.
```json
{
  "desde": "2026-11-03",
  "hasta": "2026-11-04",
  "total_efectivo": 2000.0,
  "total_mercado_pago": 20000.25,
  "total": 22000.25,
  "dias": [
    { "fecha": "2026-11-03", "efectivo": 2000.0, "mercado_pago": 15000.0, "total": 17000.0 },
    { "fecha": "2026-11-04", "efectivo": 0.0, "mercado_pago": 5000.25, "total": 5000.25 }
  ]
}
```


## 6. Endpoints de Pasarela de Pagos

Módulo encargado de la comunicación con los servidores de Mercado Pago (MP) y la acreditación de reservas.

* **`POST /api/payments/create`**
* **Descripción:** Configura el SDK de MP y genera la preferencia de pago. El `unit_price` que se envía es el `monto_total` guardado en la reserva; el cliente no manda ningún importe.
* **Vínculo:** Inyecta el UUID local de la reserva en el atributo `external_reference` de MP para garantizar trazabilidad. Configura el diccionario `back_urls` (rutas de éxito, fallo, pendiente) a partir de `FRONTEND_URL` y la `notification_url` a partir de `BACKEND_PUBLIC_URL`. Si `BACKEND_PUBLIC_URL` es una dirección local (`localhost`, `127.0.0.1`), la preferencia se crea sin `notification_url`.
* **Plazo:** La preferencia vence junto con la reserva (`expires` y `expiration_date_to`) y excluye los medios que se acreditan tarde (`ticket` y `atm`). Con el plazo vencido responde `409`. Si igual entra un pago aprobado de una reserva vencida, se confirma si hay cupo; si no, se reembolsa con la API de reembolsos de Mercado Pago y se avisa al titular por correo.
* **`POST /api/payments/webhook`**
* **Descripción:** Ruta de escucha asíncrona para notificaciones de MP.
* **Seguridad y Lógica:** Valida la firma `x-signature` del aviso con `MERCADOPAGO_WEBHOOK_SECRET` (HMAC-SHA256 sobre el `data.id` de la URL, el `x-request-id` y el `ts`); si no es válida responde `401` y no procesa nada. Para prevenir *spoofing*, ignora el contenido del aviso y ejecuta un `payment().get()` contra la API de MP. Si está "approved" y el importe cobrado coincide al centavo con el `monto_total`, actualiza atómicamente la reserva a estado `PAGADO` en PostgreSQL y dispara la emisión del código QR y correo mediante `BackgroundTasks` devolviendo inmediatamente `200 OK` a MP. Si el importe no coincide, la reserva no se confirma y el pago queda en la tabla `pagos` para revisarlo. Un pago rechazado deja la reserva pendiente.
* **`GET /api/payments/reconcile/{reserva_id}`**
* **Descripción:** Mecanismo de contingencia para operaciones huérfanas o fallos de webhook.
* **Acceso:** Requiere sesión (`Authorization: Bearer <token>`). Solo la puede pedir el dueño de la reserva o un `ADMIN` (`401` sin sesión, `403` para otro usuario). Las reservas sin cuenta solo las puede verificar un `ADMIN`.
* **Lógica Interna:** Utiliza el método `.search()` del SDK de MP filtrando por el `external_reference`. Si detecta un pago exitoso omitido localmente, ejecuta la misma confirmación que el webhook (incluida la comparación del importe). Responde `status`: `reconciliado`, `pendiente`, `importe_distinto` u `ok` (la reserva ya no estaba pendiente).
* **`GET /api/payments/test-user`**
* **Descripción:** Auxiliar de desarrollo; responde `404` cuando `ENVIRONMENT=production`.


## 7. Dominios de Autenticación y Seguridad

FastAPI gestiona dos tipos de llaves criptográficas completamente separadas para evitar exposición sistémica.

* **Sesiones de API (HS256):** El sistema utiliza la variable `AUTH_SECRET_KEY` (criptografía simétrica) para firmar los tokens de los administradores y personal de barrera. Se verifica internamente en el backend.
* **Códigos QR de Acceso (ES256):** El sistema utiliza un par asimétrico de llaves de curva elíptica. El backend emplea la `JWT_PRIVATE_KEY` de manera exclusiva para emitir y firmar las credenciales QR. La `VITE_PUBLIC_KEY` se extrae mediante `/bootstrap` y permite a la aplicación PWA verificar la autenticidad matemática de los QRs sin capacidad de emitir nuevos.