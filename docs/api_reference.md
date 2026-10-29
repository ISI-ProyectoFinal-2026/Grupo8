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
* **Campos Principales:** ID (`UUID`), `user_id` (clave foránea a usuarios; es nulo cuando la reserva se hizo sin iniciar sesión), fecha y hora de la reserva, cantidad de personas.
* **Lógica de Negocio:** Estado de pago manejado por `EstadoPagoEnum` (Pendiente, Pagado, Cancelado).
* **Seguridad:** Identificador único para códigos QR (`jwt_jti`).
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
* **Modelo de Conflictos de Sincronización (`ConflictosSincronizacion`)**
* **Campos Principales:** ID (`UUID`), `reserva_id` (`UUID`), `jti_involucrado`, `motivo`, `fecha_registro`.
* **Uso:** Tabla de auditoría para derivar reservas que presentan colisiones de concurrencia o duplicidad durante el escaneo offline.


## 2. Esquemas de Validación y Transferencia (Pydantic)

FastAPI utiliza Pydantic para garantizar la serialización y validación estricta de todos los *payloads* de entrada y salida, con mensajes de error normalizados en español.

* **`ReservaCreate` (Payload de Entrada)**
* **Personas (`personas`):** Lista de `PersonaReserva` con entre 1 y `MAX_PERSONAS_POR_RESERVA` (10) elementos. La cantidad de personas de la reserva es el largo de la lista y el titular es la primera persona; ya no se envían `cantidad_personas` ni `titular`.
* **`PersonaReserva`:** `nombre` (2 a 100 caracteres, solo letras, espacios, puntos, apóstrofes y guiones), `edad` (entero estricto entre 0 y 120), `condicion` (`visitante` o `socio`) y `dni` (7 u 8 dígitos; obligatorio para socios y sin repetirse dentro de la reserva).
* **Fechas:** Formato AAAA-MM-DD. El sistema valida que el ingreso no sea anterior a "hoy" (hora de Argentina), el egreso no sea anterior al ingreso y la estadía no supere `MAX_NOCHES_POR_RESERVA` (10).
* **Email:** Validado mediante `EmailStr` empleando la dependencia `email-validator`.
* **Teléfono:** Ya no se pide ni se valida al crear una reserva. Si un cliente anterior lo envía, se ignora y no se guarda.
* **`ReservaResponse` (Payload de Salida)**
* Esquema dedicado al formateo seguro de los datos de la reserva hacia el frontend, omitiendo datos sensibles internos.
* Incluye `telefono` solo para las reservas anteriores que lo tienen guardado (las nuevas lo devuelven en `null`; la columna se conserva para poder seguir leyéndolas).
* Incluye `personas` (lista de `PersonaOut`: nombre, edad, condición, DNI, precio base, porcentaje de descuento y precio final). Las reservas anteriores a la tabla de personas devuelven una lista vacía.
* **`CotizarRequest` / `CotizarResponse`**
* **Request:** `personas`, con entre 1 y `MAX_PERSONAS_POR_RESERVA` (10) elementos de `PersonaCotizar`: `edad` (entero estricto entre 0 y 120) y `condicion` (`visitante` o `socio`). No se envía ningún importe: el sistema ignora cualquier precio que mande el cliente.
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
* **Alcance actual:** El precio es por persona y no depende de los días ni del tipo de reserva.
* **Manejo de Errores:** Devuelve 422 si no hay personas, hay más del máximo o alguna edad o condición es inválida.
* **`POST /reservas`**
* **Descripción:** Crea una nueva reserva inyectando datos a través de `ReservaCreate`. Funciona con o sin sesión: no recibe `user_id`. Si el pedido trae un token válido, la reserva queda asociada al usuario de ese token; sin token se crea igual y `user_id` queda nulo. Un `user_id` enviado en el cuerpo se ignora.
* **Sesión opcional:** Usa `get_current_user_optional` (`core/auth_opcional.py`). Con un token inválido o vencido responde 401 (no se trata como visitante) para que el frontend sepa que debe volver a iniciar sesión.
* **Cupo:** Las reservas canceladas y las pendientes abandonadas (más antiguas que `RESERVA_PENDIENTE_TTL_MINUTES`, 30 minutos por defecto) no ocupan cupo; las pendientes dentro del plazo sí, para evitar la sobreventa mientras se espera el pago.
* **Manejo de Errores:** Devuelve código HTTP 400 si la petición supera el límite máximo calculado por `capacity_service.py`, o 422 si la validación Pydantic falla (ej. datos mal formados).
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


### `POST /api/v1/ingresos/bulk-sync`

* **Tag:** Ingresos y Sincronización.
* **Seguridad:** Requiere el JWT de sesión de un usuario con rol `SEGURIDAD` (Header: `Authorization: Bearer <token>`). Emite código 401 si no hay un token válido o está vencido, y 403 si el usuario tiene otro rol (incluido `ADMIN`). En ambos casos no se procesa el lote.
* **Descripción:** Recibe en lote los ingresos registrados por la PWA sin conexión. Procesa el arreglo verificando cada reserva, detectando duplicidades y efectuando un *commit* único.
* **Request Body (`SyncIngresosRequest`):**
```json
{
  "ingresos": [
    { "jti": "abc-123", "reserva_id": 41, "fecha_escaneo": "2026-10-03T14:22:05Z" }
  ]
}

```

* **Respuesta Exitosa (200 OK):**
```json
{
  "procesados": 1,
  "conflictos": 1,
  "sincronizados_jti": ["abc-123", "def-456"],
  "errores": ["Reserva 99 no encontrada en el sistema."]
}

```

* **Manejo de Errores:** Retorna HTTP 500 realizando un *rollback* de todo el lote ante un fallo crítico en la base de datos.


## 5. Endpoints de Pasarela de Pagos

Módulo encargado de la comunicación con los servidores de Mercado Pago (MP) y la acreditación de reservas.

* **`POST /api/payments/create`**
* **Descripción:** Configura el SDK de MP y genera la preferencia de pago. El `unit_price` que se envía es el `monto_total` guardado en la reserva; el cliente no manda ningún importe.
* **Vínculo:** Inyecta el UUID local de la reserva en el atributo `external_reference` de MP para garantizar trazabilidad. Configura el diccionario `back_urls` (rutas de éxito, fallo, pendiente) y la `notification_url`.
* **`POST /api/payments/webhook`**
* **Descripción:** Ruta de escucha asíncrona para notificaciones de MP.
* **Seguridad y Lógica:** Para prevenir *spoofing*, ignora el contenido del aviso y ejecuta un `payment().get()` contra la API de MP. Si está "approved", actualiza atómicamente la reserva a estado `PAGADO` en PostgreSQL y dispara la emisión del código QR y correo mediante `BackgroundTasks` devolviendo inmediatamente `200 OK` a MP.
* **`GET /api/payments/reconcile/{reserva_id}`**
* **Descripción:** Mecanismo de contingencia para operaciones huérfanas o fallos de webhook.
* **Lógica Interna:** Utiliza el método `.search()` del SDK de MP filtrando por el `external_reference`. Si detecta un pago exitoso omitido localmente, ejecuta la actualización de estado.


## 6. Dominios de Autenticación y Seguridad

FastAPI gestiona dos tipos de llaves criptográficas completamente separadas para evitar exposición sistémica.

* **Sesiones de API (HS256):** El sistema utiliza la variable `AUTH_SECRET_KEY` (criptografía simétrica) para firmar los tokens de los administradores y personal de barrera. Se verifica internamente en el backend.
* **Códigos QR de Acceso (ES256):** El sistema utiliza un par asimétrico de llaves de curva elíptica. El backend emplea la `JWT_PRIVATE_KEY` de manera exclusiva para emitir y firmar las credenciales QR. La `VITE_PUBLIC_KEY` se extrae mediante `/bootstrap` y permite a la aplicación PWA verificar la autenticidad matemática de los QRs sin capacidad de emitir nuevos.