# Documentación Técnica 

Este documento centraliza las decisiones de arquitectura, el diseño de la base de datos, los motores de validación criptográfica y la topología de la infraestructura de Qamp. El sistema opera bajo un enfoque B2B2C, separando la lógica de software de la oferta física del camping.

## 1. Arquitectura de Despliegue e Integración Continua (CI/CD)

El sistema está orquestado mediante un pipeline de CI/CD configurado en GitHub Actions (`.github/workflows/test.yml`) que exige una cobertura mínima de código del 80%.

### 1.1. Frontend (Vercel)

* **Alojamiento y Compilación:** La Progressive Web App (PWA) se aloja en Vercel, apuntando el directorio raíz a `frontend/pwa-acceso` para aislar el entorno de Vite dentro del monorepo.


* **Punto de Entrada:** Se validó la trazabilidad desde `src/main.tsx` y la compilación es automatizada mediante Node.js (v20.19.0) y Vite.


* **Gestión de Claves:** La clave pública asimétrica (`VITE_PUBLIC_KEY`) requerida para verificar los QR se inyecta de forma segura a través del dashboard de Vercel.


* **Gatillos de Despliegue:** Se configuraron webhooks para ejecutar redespliegues automáticos ante integraciones exitosas en la rama `main`.


* **Rutas de la SPA (Issue 21.1):** `frontend/pwa-acceso/vercel.json` reescribe todas las rutas a `index.html`. Sin esa regla, entrar directo a una ruta interna (por ejemplo `/pago/exito`, a donde vuelve Mercado Pago) devuelve 404 en Vercel. La dirección del backend se inyecta con `VITE_API_URL`.



### 1.2. Backend (Render)

* **Entorno y Configuración:** El servidor API REST (FastAPI) está alojado en Render (plan Free) apuntando al directorio `backend`, con Python 3.13 (`PYTHON_VERSION`). El build convierte el `Pipfile.lock` en `requirements.txt` con `pipenv requirements` y lo instala con pip, así se usan exactamente las versiones bloqueadas.


* **Inicialización (Issue 21.1):** El comando de arranque es `alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port $PORT`: las migraciones se aplican solas antes de cada arranque y, si una falla, el servicio no se publica. Expone además un endpoint de salud (`/health`). En el plan Free el servicio se suspende tras 15 minutos sin tráfico y tarda cerca de un minuto en volver.


* **Secretos (Fail-Fast):** El archivo `core/config.py` usa `pydantic-settings` para abortar el arranque de FastAPI inmediatamente si faltan variables esenciales (como `DATABASE_URL` o `JWT_PRIVATE_KEY`). Todos los secretos están encriptados en el hardware virtual de Render, ignorando el `.env` en el control de versiones.



### 1.3. Base de Datos (Neon)

* **Elección (Issue 21.1):** La base PostgreSQL publicada está en Neon (plan Free) y no en Render, porque la base gratuita de Render vence a los 30 días de creada y el sistema tiene que seguir disponible hasta la presentación final. La base gratuita de Neon no vence; se suspende tras unos minutos sin consultas y se reactiva sola.


* **Conexión:** El backend recibe la cadena de conexión directa de Neon (sin `-pooler`, con `sslmode=require`) en `DATABASE_URL`, cargada como variable de entorno en Render.


El detalle de la configuración de cada plataforma, las variables y el resultado de la prueba del pago con el sandbox está en la [Guía de Despliegue](./deployment.md).

## 2. Capa de Datos, Modelos y ORM

La base de datos relacional PostgreSQL administra las transacciones del sistema con un diseño centrado en la integridad y la trazabilidad.

### 2.1. Conexión y Motor

* **Infraestructura Base:** El módulo `core/database.py` utiliza SQLAlchemy con `create_engine` conectado al puerto local 5435 (para evitar bloqueos con servicios de Windows), utilizando el driver sincrónico `psycopg2-binary`.


* **Gestión de Sesiones:** Se emplea `sessionmaker` con las propiedades `autocommit=False` y `autoflush=False` para un control fino sobre el ciclo de transacciones.



### 2.2. Entidades Principales

* **Modelo Usuario (`models/user.py`):** Utiliza UUID como identificador único principal. Incluye atributos clave como correo electrónico, hash de contraseña, DNI, indicador de membresía (`is_socio`), fecha de vencimiento de la cuota (`membresia_vence`, Issue 13.3), baja lógica (`activo`), marcas de auditoría (`created_at`, `updated_at`) y un rol de sistema basado en `RoleEnum` (Admin, Seguridad, Cliente).


* **Modelo Reserva (`models/reserva.py`):** Almacena el ID (`UUID`), una clave foránea (`user_id`), fecha y hora, cantidad de personas y el `jwt_jti` (identificador único para el código QR). Controla su avance mediante `EstadoPagoEnum` (Pendiente, Pagado, Cancelado). Desde la Issue 19.3 guarda también el tipo elegido (`tipo_reserva_id`) y su precio en ese momento (`precio_tipo`); las reservas anteriores los tienen en nulo.


* **Configuración del camping (`models/configuracion.py`):** una fila por camping con `capacidad_total`, `porcentaje_buffer_offline` y `max_personas_por_reserva` (Issue 19.1), además de las reglas de cancelación (Issue 22.1): `dias_cancelacion` (1 por defecto) y `porcentaje_devolucion` (100 por defecto). El administrador la edita desde el panel; los valores del `.env` solo se usan para crearla la primera vez.


* **Modelo Tipo de Reserva (`models/tipo_reserva.py`, Issue 19.2):** `nombre` (único sin distinguir mayúsculas), `precio`, `forma_cobro` (`POR_PERSONA` o `POR_UNIDAD`), `max_personas`, `cantidad_unidades` (vacío = sin límite; siempre vacío en los tipos por persona) y `activo`. La migración crea Entrada general, Carpa y Cabaña.


* **Modelo Pago (`models/pago.py`, Issue 17.1):** Un registro por cada pago que informa Mercado Pago, aprobado o no: `reserva_id`, `mp_payment_id` (único), estado, detalle, monto, moneda, medio de pago, fechas y `respuesta_mp` (JSONB). Si se borra la reserva, el pago se conserva con `reserva_id` en nulo. Desde la Issue 22.2 registra también la devolución: `monto_devuelto`, `fecha_devolucion` y `devolucion_estado` (`devuelto` o `pendiente_revision`, cuando Mercado Pago no pudo devolver y hay que hacerlo a mano). Las tres quedan en nulo si nunca hubo devolución.



### 2.3. Control de Versiones y Seeding

* **Migraciones:** Alembic mantiene la sincronización entre SQLAlchemy y la base de datos. La revisión automática `f30ae74360fe_initial_schema.py` tradujo los modelos ORM a instrucciones DDL, aplicables con el comando `alembic upgrade head`.


* **Conexión de Alembic (Issue 21.1):** `alembic/env.py` usa `DATABASE_URL` cuando está definida (la misma que la app), y si no, arma la conexión local con las variables `POSTGRES_*`. Así las mismas migraciones se aplican en el contenedor local y en la base publicada.


* **Inicialización de Datos (`seed.py`):** Este script resetea tablas relacionales de manera inversa (primero reservas, luego usuarios) y genera automáticamente un Administrador, personal de Seguridad y cinco usuarios de prueba junto con 15 registros de reservas mixtas (pasadas y futuras) para visualizar métricas.



## 3. Core de Negocio y Seguridad de Endpoints

El núcleo (FastAPI) está organizado de forma modular (`api/`, `core/`, `models/`, `schemas/`, `services/`, `security/`).

### 3.1. Motores Internos

* **Capacidad (`services/capacity_service.py`):** Audita el aforo del camping devolviendo un error HTTP 400 si las peticiones superan el límite máximo establecido.
  * `lugares_ocupados` calcula cuántos lugares están ocupados en las fechas pedidas. Ocupan cupo las reservas confirmadas, finalizadas y en alerta de clonación, y las `PENDIENTE` que están dentro del plazo `RESERVA_PENDIENTE_TTL_MINUTES` (10 minutos por defecto, configurable en el `.env`). No ocupan cupo las `CANCELADA` ni las `PENDIENTE` más antiguas que ese plazo. `cancelar_reservas_vencidas` pasa esas pendientes a `CANCELADA` al crear y al consultar reservas. Una pendiente que cumple justo el plazo todavía cuenta.
  * `check_availability` compara lo ocupado más el margen offline contra la capacidad total. `crear_reserva` solo invoca estos dos métodos.


* **Tarifas (`services/pricing_service.py`):** Algoritmo de *pricing* dinámico que determina el costo final basado en la cantidad de huéspedes declarados. Con un tipo por persona, el precio base de cada persona es el precio del tipo (con los mismos descuentos); con un tipo por unidad, el total es el precio de la unidad × noches, sin descuentos (Issue 19.3).


* **Endpoints Transaccionales (`api/reservas.py`):** Emplean Pydantic (`ReservaCreate` y `ReservaResponse`) para la serialización estricta de entrada y salida.



### 3.2. Middleware de Autenticación

* **RBAC (Control de Acceso Basado en Roles):** Se blindan rutas (como `GET /reservas/`) requiriendo tokens JWT asíncronos mediante `OAuth2PasswordBearer`.


* La dependencia `get_current_user` verifica el atributo `sub` del token y confirma la existencia del usuario en PostgreSQL, mientras que `require_role` valida los permisos administrativos.


* Este token de sesión interno se firma con el algoritmo simétrico HS256 utilizando `AUTH_SECRET_KEY`.


* **Inicio de sesión (Issue 13.1):** `POST /auth/login` (`api/auth.py` y `services/auth_service.py`) recibe DNI o correo y contraseña. Las contraseñas se guardan con bcrypt (mínimo 8 caracteres y máximo 72 bytes) y cualquier falla responde 401 con el mismo mensaje. Si el usuario no existe se compara contra un hash ficticio, para que el tiempo de respuesta no delate qué cuentas existen. No hay registro público: las cuentas las da de alta el administrador.


* **Duración de la sesión:** el token dura `AUTH_TOKEN_EXPIRE_MINUTES` (60 minutos) para clientes, socios y administradores, y `GUARD_TOKEN_EXPIRE_HOURS` (168 horas) para el guardia. No hay *refresh token*: al vencer, se vuelve a iniciar sesión.


* **Autorización por rol (Issue 13.2):** `get_current_user_optional` (sin token devuelve `None`; con un token inválido o vencido responde 401) y `require_role(*roles)`, que acepta uno o varios roles. Solo se aceptan tokens HS256: los tokens ES256 de los QR no sirven para iniciar sesión. El rol se lee de la base en cada petición, así que el claim `rol` del token nunca da permisos.


* **`bulk-sync` solo para el guardia (Issue 13.5):** `POST /api/v1/ingresos/bulk-sync` exige el rol `SEGURIDAD`. Sin token responde 401 y con otro rol, incluido `ADMIN`, 403; en ambos casos no se guarda nada del lote.


* **Usuarios dados de baja:** un JWT no se puede anular, pero el backend busca al usuario en cada petición. Si está inactivo responde 401, así que una sesión abierta deja de valer en la petición siguiente, sin lista de tokens revocados. En el login, el inactivo se rechaza después de comprobar la contraseña, con el mismo "Credenciales inválidas", para no revelar si la cuenta existe.



### 3.3. Configuración del Camping y Tipos de Reserva (Issue 19)

* **Configuración editable (Issue 19.1):** cupo, buffer offline y máximo de personas por reserva se leen de `configuracion_camping` y no de `settings`. Los usan `capacity_service.py`, la validación de reservas, el bootstrap de la PWA y el monitor de ocupación. Se editan con `GET` y `PUT /api/v1/admin/configuracion`.


* **Buffer como porcentaje:** se guarda como porcentaje del cupo y se convierte a personas redondeando hacia arriba. Cupo online = capacidad − buffer en personas − reservas activas. El máximo por reserva no puede superar ese cupo online, para que una reserva con el máximo siempre se pueda vender por la web.


* **El máximo de personas se controla en el endpoint:** los validadores de Pydantic no tienen acceso a la base, así que `POST /reservas` y `POST /reservas/cotizar` comparan la cantidad con la configuración guardada y con el máximo del tipo (`services/tipo_reserva_service.py`).


* **Tipos de reserva (Issue 19.2):** ABM solo para `ADMIN` en `/api/v1/admin/tipos-reserva` y listado público de los activos en `/api/v1/tipos-reserva`. No se borran: se desactivan. La clave foránea desde `reservas` es `RESTRICT`, así que un tipo con reservas no se puede eliminar. El máximo de personas de un tipo no puede superar el máximo general por reserva.


* **Precio del momento (Issue 19.3):** la reserva guarda `precio_tipo`. Si después el administrador cambia el precio del tipo, las reservas ya hechas no cambian.


* **Unidades por noche:** `unidades_ocupadas()` en `capacity_service.py` cuenta noche por noche (una reserva del 10 al 12 ocupa las noches del 10 y del 11, y el día de egreso libera la unidad). Cuentan las mismas reservas que para la capacidad: confirmadas, finalizadas, en alerta y pendientes dentro del plazo de pago. Si en alguna noche están todas ocupadas, la reserva se rechaza con 409. Las personas de una cabaña también cuentan para la capacidad total del camping.


* **Última unidad con pedidos simultáneos:** al reservar un tipo por unidad, la fila del tipo se bloquea (`SELECT ... FOR UPDATE`) hasta el commit. Así, dos pedidos a la vez por la última cabaña no se venden los dos: el segundo espera y después la ve ocupada.


* **`tipo_reserva_id` sigue siendo opcional en el backend:** la web lo envía siempre, pero sin tipo la reserva funciona como antes de la Issue 19, con `PRECIO_BASE_POR_PERSONA`. Así no hubo que cambiar los tests que reservan sin tipo.


## 4. Sistema Offline-First y Motor Criptográfico (PWA)

La aplicación del guardia resuelve los cuellos de botella mediante una descentralización basada en la Web Crypto API y JWT, obteniendo validaciones en 2 a 5 milisegundos.

### 4.1. Generación de Credenciales (Servidor)

* Al pagarse una reserva, el módulo `SecurityService` instancia el esquema `JWTPayloadSchema` validando tipos de datos estrictos (identificador único `jti`, ID de reserva, clasificación, aforo y expiración `exp`).


* La librería `PyJWT` firma este paquete usando la curva elíptica P-256 y hash SHA-256 (ES256) empleando la `JWT_PRIVATE_KEY`. Las firmas de curva elíptica reducen enormemente la densidad visual del código QR resultante respecto al formato RSA.


* El script `generate_keys.py` es el encargado de generar este par de claves una única vez y es idempotente (no sobrescribe claves existentes).



### 4.2. Validación Offline y Decisión Tecnológica (Frontend)

* **Problema de Entorno:** Librerías convencionales como `jsonwebtoken` están diseñadas para Node.js y fallaban al compilar en el navegador.


* **Solución:** Se implementó la librería `jose`, la cual interactúa directamente con el motor nativo del navegador (*Web Crypto API*) utilizando la `VITE_PUBLIC_KEY` embebida.


* El validador `verifyQRToken` revisa la firma y los reclamos temporales. Falla automáticamente si el reloj interno supera la expiración (`exp`), o ante la menor alteración de caracteres, devolviendo `null` sin revelar estados ambiguos.



## 5. Base de Datos Local y Tolerancia a Fallos de Red

La PWA emplea IndexedDB envuelta en promesas con la librería Dexie.js (archivo `dbService.ts`), estructurada en *stores*: `configuracion`, `ingresos_pendientes`, `historial` y `blacklist`. `ingresos_pendientes` es la cola que se envía al servidor; `historial` es solo lo que ve el guardia (ver 5.4).

### 5.1. Bootstrap y Lista Negra

* Al abrir la pantalla del guardia y al volver la conexión, el frontend consume `GET /api/v1/sincronizacion/bootstrap` con el token del guardia y descarga todas las páginas de la lista de reservas canceladas que todavía pueden presentarse (egreso hoy o posterior). La lista local se **reemplaza** completa en una sola transacción; si falla cualquier página, se conserva la anterior. Detalle en [pwa-bootstrap-y-blacklist.md](./pwa-bootstrap-y-blacklist.md).


* Descarga también la configuración guardada desde el panel: aforo máximo (50 por defecto) y margen offline en personas (10 % de la capacidad, redondeado hacia arriba: 5 por defecto).



### 5.2. Control de Aforo Local y Transacciones ACID

* Al detectar un QR válido, la base local realiza una transacción indivisible (ACID): revisa si el identificador `jti` ya existe en `ingresos_pendientes` para evitar lectura múltiple, suma la cantidad de personas al aforo local y registra el ticket. Si la lectura excede la capacidad o la transacción falla por error de hardware, Dexie ejecuta un *rollback* de los datos.



### 5.3. Background Sync y Sincronización

* El archivo `syncService.ts` escucha el evento `online` en `window`.


* Las entradas se leen en orden FIFO absoluto según la marca temporal `fecha_escaneo.getTime()` y se despachan en lote hacia `POST /api/v1/ingresos/bulk-sync`.


* Se emplea un mecanismo de mitigación de red intermitente mediante *Backoff Exponencial* (reintentos con retrasos de 5s, 15s y 45s).


* **Éxito parcial:** cada registro del lote se valida y se guarda por separado (un *savepoint* por registro). Uno inválido va a `errores` y el resto se guarda. La PWA borra de su cola solo los `jti` confirmados en `sincronizados_jti`; los que fallaron quedan para el próximo intento.


* **El `jti` se genera una sola vez**, al registrar el ingreso (`crypto.randomUUID()`), y viaja igual en cada reintento. Así un reintento nunca duplica un cobro.


* **Sesión del guardia al sincronizar (Issue 13.5):** cada lote viaja con `Authorization: Bearer <token>`. El token del guardia dura 168 horas y, sin conexión, su vencimiento no interrumpe nada: escanear QR e ingresar personas a mano son operaciones locales que no usan el token, y los ingresos quedan en la cola de IndexedDB. Si la app se abre sin red con el token vencido, la sesión se conserva (solo para el guardia y solo sin conexión; con conexión un token vencido se descarta). Al volver la red, si el servidor responde 401, `syncService.ts` pausa el envío sin reintentos con *backoff* (con el mismo token fallarían igual), conserva toda la cola, avisa "Iniciá sesión de nuevo para sincronizar" y emite `AUTH_EXPIRED_EVENT` para llevar al guardia al login. Con 403 conserva la cola sin cerrar la sesión, y sin token guardado no envía nada. Después de iniciar sesión, la cola sale en el siguiente evento `online` o en el chequeo periódico de 5 minutos, ya con el token nuevo; como el `jti` no cambia, no se duplica ningún ingreso.


* **QR clonado (doble gasto offline):** la columna `jti` es única, así que la base es el árbitro final, incluso con dos pedidos simultáneos. El mismo `jti` desde el mismo `dispositivo_id` es un reintento de red; desde otro dispositivo es un clon: el primero que llegó queda como ingreso, el segundo se guarda en `conflictos_sincronizacion` y la reserva pasa a `ALERTA_CLONACION`. No se expulsa a nadie automáticamente, porque el titular real puede ser el que sincronizó segundo: decide un administrador.


* **La alerta no se puede pisar:** el estado de la reserva solo cambia por métodos del modelo que se niegan a tocar una reserva en alerta, y la fila se bloquea (`SELECT ... FOR UPDATE`). Un pago que llega durante la alerta se registra, pero no confirma ni cancela la reserva.


* **Resolución:** al entrar en alerta se guarda el estado anterior (`estado_antes_alerta`). Cuando el administrador resuelve el incidente, la reserva vuelve a ese estado, ajustado al pago actual, y queda una fila de auditoría en `resoluciones_alerta` con quién resolvió y cuándo.


* **Hora del escaneo:** se guarda la hora en que se escaneó, no la de la sincronización, en UTC (`timestamptz`). El sistema confía en el reloj del celular del guardia; ver [zonas-horarias.md](./zonas-horarias.md).


* **Arranque (Issue 26.4):** `LayoutAcceso.tsx` inicia la sincronización de fondo, así funciona en cualquier pantalla de la PWA. `iniciarBackgroundSync()` es idempotente: volver a llamarla no suma listeners ni intervalos.


* **Última sincronización (Issue 26.3):** con cada respuesta OK de `bulk-sync` (también con éxito parcial), `syncService.ts` guarda la hora en `configuracion` (`ultima_sincronizacion`, ISO en UTC). Ante un error no la cambia.


* **Aviso de sesión vencida (Issue 26.3):** el 401 emite `AUTH_EXPIRED_EVENT` con `detail.mensaje`; `AuthContext` lo guarda al cerrar la sesión y el login del guardia lo muestra. Los cierres sin mensaje (por ejemplo, desde el panel) no muestran aviso.



### 5.4. Historial del Dispositivo y Estado de la Conexión (Issue 26)

* **Cola y vista separadas:** cada ingreso aceptado (QR o manual) se guarda en `ingresos_pendientes` y en `historial` dentro de la misma transacción. El historial se recorta a `MAX_HISTORIAL` (50, en `dbService.ts`) borrando los más viejos **solo** de `historial`: un ingreso sin sincronizar se sigue enviando aunque ya no aparezca en la lista. El historial no guarda nombre, DNI ni monto.


* **Confirmación:** `marcarComoSincronizados()` borra de la cola los `jti` de `sincronizados_jti` y los marca como `sincronizado` en `historial`, en una sola transacción. Si falla, la cola queda intacta y el reenvío no duplica nada, porque el backend reconoce el mismo `jti`.


* **Migración a `version(4)`:** solo se redeclara `historial` (índice `jti`, `reserva_id` pasa a texto); las demás tablas y la clave primaria no cambian, así la actualización no toca la cola. Los pendientes de antes de la v4 se envían igual, pero no aparecen en el historial.


* **Reactividad:** `hooks/useConexion.ts` combina los eventos `online`/`offline`, el conteo de pendientes con `useLiveQuery` de Dexie (se actualiza solo cuando cambia la tabla, sin *polling*) y el evento `sync-status` para saber si hay un envío en curso. Lo usan la barra superior y Estado de sincronización.


* **Rutas sin conexión:** `/acceso`, `/acceso/manual`, `/acceso/historial` y `/acceso/sincronizacion` comparten `LayoutAcceso` y están protegidas para `SEGURIDAD`. Funcionan offline porque el service worker (Workbox, `NavigationRoute`) responde cualquier navegación con el `index.html` guardado.



## 6. Módulo de Pagos y Reconciliación Transaccional

La integración oficial con Mercado Pago gestiona todo el ciclo financiero en `services/payment_service.py` y `api/payments.py`.

### 6.1. Generación de Orden y Webhooks

* El método `POST /api/payments/create` envía las preferencias al SDK vinculando el UUID local mediante el parámetro `external_reference`. Define también las `back_urls` (éxito, fallo, pendiente) y la `notification_url`, que salen de `FRONTEND_URL` y `BACKEND_PUBLIC_URL` (Issue 17.4). Con un backend local la preferencia se crea sin `notification_url`, porque Mercado Pago no acepta direcciones locales.


* **Registro de pagos (Issue 17.1):** el webhook y la reconciliación guardan cada pago en la tabla `pagos` con un único `INSERT ... ON CONFLICT DO UPDATE` sobre `mp_payment_id`: un aviso repetido actualiza la fila en lugar de crear otra. `respuesta_mp` guarda solo una lista de campos permitidos, así nunca se almacenan los datos del pagador ni de la tarjeta (`payer`, `card`, `additional_info`, `point_of_interaction`).


* **Avisos auténticos (Issue 17.3):** el webhook valida la firma `x-signature` (HMAC-SHA256 sobre el `data.id` de la URL, el `x-request-id` y el `ts`) con `MERCADOPAGO_WEBHOOK_SECRET`, usando el validador del SDK. Si no es válida responde 401 sin consultar a Mercado Pago; sin clave configurada se rechazan todos los avisos.


* El webhook transaccional (`POST /api/payments/webhook`) mitiga vulnerabilidades de suplantación de origen (*spoofing*) consumiendo activamente `payment().get()` antes de ejecutar el `db.commit()` que cambia el estado a `PAGADO`.


* **Confirmación única (Issues 17.2 y 17.3):** el webhook y la reconciliación confirman por la misma función, `confirmar_pago()`. Bloquea la reserva (`SELECT ... FOR UPDATE`), compara al centavo el importe cobrado con `monto_total`, la marca como pagada y programa el correo con el QR. El correo sale solo cuando la reserva pasa a pagada: un aviso repetido o una segunda reconciliación no lo reenvían. Si el importe no coincide, la reserva no se confirma y el pago queda en `pagos` para revisarlo. Un pago rechazado deja la reserva pendiente, para poder reintentar dentro del plazo.


* **Tipo del QR (Issue 17.2):** el `typ` sale de las personas de la reserva: `socio` solo si todas son socias; con algún visitante, o sin personas cargadas, `visitante`.


### 6.2. Plazo de Pago (Issue 17.5)

* Una reserva pendiente tiene `RESERVA_PENDIENTE_TTL_MINUTES` (10 minutos) para pagarse, contados desde `fecha_reserva`. `POST /reservas` devuelve el vencimiento en `vencimiento_pago`.


* La preferencia vence a la misma hora (`expires` y `expiration_date_to`) y excluye los medios que se acreditan días después (`ticket` y `atm`: Pago Fácil y Rapipago).


* Las pendientes vencidas pasan a `CANCELADA` al crear y al consultar reservas (`cancelar_reservas_vencidas()`), sin tarea programada, y liberan el cupo.


* **Pago tardío:** si igual llega un pago aprobado de una reserva vencida (por ejemplo, una tarjeta que quedó en revisión), se confirma si todavía hay cupo. Si no hay cupo, se devuelve el dinero con la API de reembolsos de Mercado Pago y se avisa al titular por correo; si el reembolso falla, el correo avisa que la devolución está en proceso y hay que hacerla a mano. En todos los casos el pago queda registrado.


* En la web, después de crear la reserva se pasa a una pantalla propia (`/reservas/pagar`) con la cuenta regresiva y el botón "Ir a pagar". La reserva pendiente se guarda en `sessionStorage`, así sobrevive a la ida y vuelta a Mercado Pago y se puede reintentar después de un rechazo.



### 6.3. Auditoría y Contingencia de Huérfanas

* En caso de pérdida de webhooks (fallo de servidor o red), se implementó el endpoint contingente `GET /api/payments/reconcile/{reserva_id}`. Usa el filtro `.search()` de Mercado Pago sobre el `external_reference` para asentar cobros ignorados. Solo lo puede pedir el dueño de la reserva o un ADMIN (Issue 17.3); las reservas sin cuenta solo las verifica un ADMIN.
* Al volver de Mercado Pago, la pantalla `/pago/exito` consulta `GET /api/payments/estado/{reserva_id}` con el `payment_id` de la URL, sin sesión. Comprueba el pago con Mercado Pago y confirma la reserva por el mismo camino que el webhook, así que también cubre a los visitantes cuando el aviso no llega (por ejemplo, con el backend local, sin `notification_url`).


* `GET /api/payments/test-user` es un auxiliar de desarrollo y responde 404 con `ENVIRONMENT=production` (Issue 17.3).


* **Retorno automático (Issue 21.1):** la preferencia incluye `auto_return: "approved"` solo cuando `FRONTEND_URL` es una dirección publicada (`usa_retorno_automatico()`), porque Mercado Pago no acepta `auto_return` con `back_urls` locales. Con el pago aprobado, Mercado Pago devuelve al cliente a `PagoExito.tsx` sin que tenga que tocar "Volver al sitio". En desarrollo local, las pantallas de resultado se prueban con ese botón.


* **Avisos con formato `id` + `topic`:** además del aviso con `data.id` y `type=payment`, Mercado Pago envía avisos en el formato anterior (`topic=payment` y `topic=merchant_order`). El webhook los rechaza con 401 porque no superan la validación de la firma. No afectan al pago, que se confirma con el primer aviso.



## 7. Módulo Cloud de Notificaciones y Credenciales

Orquesta el proceso inmediato desde la validación del pago hasta el envío del QR mediante correo, sin crear esperas que asfixien a la pasarela de pagos.

### 7.1. Generación del QR en Memoria RAM

* El `qr_service.py` emplea las librerías `qrcode` y `Pillow` con corrección de errores nivel "M" (15%).


* Para evitar la acumulación de archivos residuales (basura) y accesos lentos en disco, la imagen PNG de la credencial se dibuja exclusivamente en un buffer temporal de memoria.



### 7.2. Servicio de Correo Electrónico

* Implementado como un patrón Singleton (`services/email_service.py`), se integra con Resend (`RESEND_API_KEY`).


* Utiliza plantillas `Jinja2` modulares (`confirmacion_reserva.html`, `recibo_pago.html`, `cancelacion_reserva.html`, `arrepentimiento_enlaces.html`) inyectando estilos CSS integrados (*inline*).


* La credencial se inserta directamente en el HTML referenciándola mediante un identificador de contenido (CID) como `cid:qr_code`.



### 7.3. Asincronía y Tareas en Segundo Plano

* FastAPI responde instantáneamente un `200 OK` al Webhook de Mercado Pago para evitar cancelaciones automáticas.


* El ensamblaje del PNG, compilado en Jinja2 y envío a Resend, es derivado a un hilo secundario empleando la funcionalidad nativa `BackgroundTasks`.


* El flujo cuenta con idempotencia: si el webhook notifica dos veces un cobro aprobado, el orquestador ignora la segunda alerta evitando duplicar envíos.



## 8. Web de Reservas y Panel de Administración (Frontend)

Las pantallas del cliente, la PWA del guardia y el panel del administrador conviven en la misma aplicación de React (`frontend/pwa-acceso`) y comparten una única sesión, pero cada una se usa como una app aparte, con su propio inicio de sesión y su propio marco: la web en `/`, el panel en `/admin` y la PWA del guardia en `/acceso`.

### 8.1. Sesión y Rutas por Rol

* **Sesión:** `context/AuthContext.tsx` guarda el token de `POST /auth/login` en `localStorage` (`qamp_token`) y lee el rol del claim `rol`. Ese rol solo decide qué se muestra: el backend vuelve a validar el rol en cada request.


* **Un inicio de sesión por app (Issue 23.1):** `/login` (clientes y socios), `/admin/login` (administrador) y `/acceso/login` (guardia), definidos en `LOGIN_POR_ROL` (`lib/auth.ts`). Las tres usan `FormularioLogin`, que lee el rol del token **antes** de guardar la sesión: si el rol no corresponde a esa app, muestra "Acceso denegado" y no inicia sesión. Así un guardia no entra al panel ni un administrador queda logueado en la web de reservas.


* **Redirección:** Después del login, cada rol va a su pantalla (`RUTA_POR_ROL` en `lib/auth.ts`): `SEGURIDAD` a `/acceso`, `ADMIN` a `/admin` y `CLIENTE` a `/mis-reservas`. El menú del `Header` cambia según el rol.


* **Sesión vencida:** Cuando una pantalla recibe un 401, dispara el evento `AUTH_EXPIRED_EVENT` y el contexto cierra la sesión. La excepción es el guardia: si su token vence sin conexión, la sesión se conserva para que pueda seguir escaneando, y se le pide iniciar sesión cuando `bulk-sync` responde 401 al volver la red.


* **Guards:** `RutaProtegida` deja pasar solo a los roles indicados (sin sesión redirige al login de esa app, indicado en `rutaLogin`; con otro rol muestra "Acceso denegado"). `RutaSocio` consulta `GET /auth/me` y limita "Perfil" y "Mis reservas" a los socios; un socio con la cuota vencida entra igual para ver su estado.



### 8.2. Panel de Administración

* **Estructura:** `/admin/*` está protegido para `ADMIN` en `pages/admin/AdminRoutes.tsx` y usa un layout común con el menú lateral.


* **Agregar una pantalla:** Cada pantalla se registra con una entrada en `pages/admin/routes.tsx` (`path`, `titulo`, `icono`, `element`). El menú y las rutas se arman a partir de esa lista, por lo que no hace falta tocar `App.tsx` ni el layout.


* **Pantallas actuales:** Inicio (banner de alertas, monitor de ocupación, personas esperadas y resumen de cobros), Gestión de reservas, Socios, Descuentos, Historial de ingresos, Egresos, Alertas, Tipos de reserva y Configuración. Las entradas con `alPie: true` (hoy, Configuración) se muestran al final del menú, encima de "Cerrar sesión".


* **Instalable (Issue 23.1):** el panel se puede instalar como app separada de la del guardia. Mientras está abierto, `hooks/useManifest.ts` cambia el manifest de la página por `public/manifest-admin.webmanifest` ("Qamp Admin", `start_url` y `scope` en `/admin/`). El service worker sigue siendo uno solo para todo el sitio.



### 8.3. Formulario de Reserva

* **Personas:** Se piden los datos de cada persona y se envía la lista completa al crear la reserva.


* **Tipo de reserva (Issue 19.4):** `Home.tsx` muestra los tipos activos de `GET /api/v1/tipos-reserva`, con estados de carga, error y vacío; ningún tipo ni precio está escrito en el frontend (`lib/tiposReserva.ts`). El tipo elegido viaja completo a las pantallas siguientes; si se recarga la página, se vuelve al inicio. El máximo de personas sale del tipo elegido. Se piden noches para todos los tipos: 0 significa pasar el día en los tipos por persona, y los tipos por unidad exigen al menos una noche.


* **Reserva por unidad:** con un tipo por unidad (cabaña), el formulario pide solo el titular y la cantidad de personas, sin la lista de personas, y el precio se muestra como precio × noches.


* **Disponibilidad:** no hay un endpoint que consulte cupos antes de reservar, así que `Disponibilidad.tsx` es un resumen del tipo, su precio y, en la cabaña, el total estimado. Aclara que la disponibilidad se confirma al reservar: si no hay lugar, el backend lo rechaza al crear la reserva.


* **Total:** Sale siempre de `POST /reservas/cotizar`; el frontend no tiene precios ni descuentos propios. Si la cotización falla por una regla del negocio (por ejemplo, más personas que el máximo del tipo), se muestra el motivo que devuelve el backend.


* **Socios:** El DNI de cada persona marcada como socio se verifica con `GET /socios/validar/{dni}`. Si el DNI no existe, no es de un socio o tiene la cuota vencida, la reserva se bloquea. Si quien reserva es un socio con sesión, sus datos aparecen precargados.


* **Correo:** Se pide confirmar el email (no se puede pegar en ese campo) para evitar errores al enviar el QR. Si el email sale de la cuenta con sesión, no se pide confirmarlo. Es una validación solo del frontend: el backend recibe un único email.



### 8.4. Gestión de Reservas (Issue 23.3)

* La pantalla del panel lista todas las reservas con `GET /reservas/` y abre el detalle con `GET /reservas/{id}` (personas, tipo de reserva, pagos de Mercado Pago y si ya ingresó). Es solo de consulta: no modifica reservas.


* **Filtros y paginación en el backend:** estado de pago, estado de la reserva, rango de fechas de ingreso, socio o visitante y un campo de búsqueda. La respuesta trae `total` e `items`, y el panel pide de a 20.


* **Búsqueda:** por titular (cada palabra, en cualquier orden), email o comienzo del número de reserva (con o sin `#`), sin importar acentos ni mayúsculas. Reutiliza la misma tabla de letras que la búsqueda del padrón de socios (ver 10.3). La lógica vive en `services/reservas_admin_service.py`.


* **Socio o visitante:** una reserva es "de socio" si la hizo una cuenta con sesión o si el titular se cargó como socio. La misma regla se usa en el filtro (SQL) y en el campo `tipo_cliente` de la respuesta, para que nunca den resultados distintos.



### 8.5. Estilo Común (Issue 24.5)

* Las tres apps comparten colores, tipografía y componentes. Todo se define en `src/index.css` (variables) y `tailwind.config.js` (escalas `tierra` y `bosque`); las pantallas no usan colores sueltos. La guía completa, con el contraste verificado de cada combinación, está en [ux-ui/estilo.md](./ux-ui/estilo.md).


* **Marca:** el panel y la PWA dicen "Qamp". La web de reservas muestra el nombre y los datos de contacto del camping que contrató el sistema, tomados de las variables `VITE_CAMPING_*` del `.env` del frontend (`src/lib/camping.ts`), así se adapta a otro camping sin tocar código.


* **PWA del guardia (Issue 26):** `components/layout/LayoutAcceso.tsx` arma una barra superior (título, indicador Online/Offline y contador de pendientes) y `BarraNavegacionInferior.tsx`, con Historial, Registro manual, Escáner, Sincronización y Cerrar sesión. La pantalla actual se marca con `aria-current="page"`. El registro manual es una pantalla propia (`RegistroManual.tsx`) con la confirmación "Ingreso registrado" y el ID local.


* **Accesibilidad:** todos los textos cumplen un contraste mínimo de 4,5:1, el foco del teclado se ve siempre y ningún estado se comunica solo con color (se suma ícono y texto).



## 9. Ocupación, Egresos y Cobros

Permite al administrador saber cuántas personas hay dentro del camping y cuánto se cobró. La lógica vive en `services/ocupacion_service.py` y `services/cobros_service.py`.

### 9.1. Cálculo de la Ocupación

* **Fórmula:** Personas de los ingresos aceptados menos personas egresadas. Se cuentan todos los movimientos y no solo los del día, porque hay estadías de varias noches.


* **Personas por ingreso:** Los ingresos con QR guardan la cantidad que trae el token y los manuales la que anota el guardia. Los registros anteriores sin cantidad cuentan como 1 persona.


* **QR clonados:** No suman, porque el segundo escaneo de un mismo `jti` queda en `conflictos_sincronizacion` y nunca llega a `ingresos_fisicos`.


* **Nunca negativa:** Si se registran egresos antes de que lleguen los ingresos offline, la ocupación queda en 0 hasta que los guardias sincronicen.


* **Capacidad y buffer:** Salen de `configuracion_camping`, que el administrador edita desde el panel (Issue 19.1). El buffer es un margen configurable, 20 % por defecto: la web vende hasta el 80 % del cupo y el resto queda para los ingresos en la puerta. Se guarda como porcentaje y se informa en personas, redondeado hacia arriba. Cambiar el valor por defecto no modifica los campings que ya tienen uno guardado.



### 9.2. Egresos

* El administrador registra las salidas desde el panel. No se puede egresar más gente de la que hay dentro (409).


* Un candado de PostgreSQL (`pg_advisory_xact_lock`) evita que dos egresos simultáneos se validen contra la misma ocupación.



### 9.3. Resumen de Cobros

* **Efectivo:** Lo cobrado en los ingresos manuales, en el día del escaneo.


* **Mercado Pago:** Solo los pagos aprobados de la tabla `pagos`, en el día de la aprobación. Un reembolso total cambia el estado del pago y deja de contarse. En una devolución parcial el pago sigue aprobado, así que se le resta `monto_devuelto` (solo si `devolucion_estado` es `devuelto`: si quedó pendiente de revisión, la plata todavía no salió).


* **Días:** Se agrupa por día de Buenos Aires, no de UTC, para que un cobro a las 23:30 cuente en el día correcto.



### 9.4. Monitor del Panel

* El Inicio muestra la ocupación sobre la capacidad, el porcentaje y el tramo de la barra reservado al buffer offline. Se actualiza cada 30 segundos y al registrar un egreso.


* **Banner de alertas (Issue 26.5):** arriba del monitor. Sus cuatro estados (cargando, sin incidentes, error y con incidentes) usan la misma caja con alto mínimo, así la respuesta de la API no desplaza el monitor (CLS).


* **Colores:** Verde por debajo del 70 %, amarillo desde el 70 % y rojo desde el 90 % (`lib/ocupacion.ts`). El nivel también se muestra en texto ("normal", "alta", "crítica").


* Debajo del monitor está el resumen de cobros, con la última semana por defecto y un rango elegible de hasta 92 días.



### 9.5. Personas Esperadas (Issue 23.2)

* Junto al monitor, el Inicio muestra cuántas reservas y personas se esperan hoy y todavía no llegaron (`GET /api/v1/admin/esperados`).


* **Qué cuenta:** reservas pagadas y no canceladas cuya estadía incluye hoy (del ingreso al egreso, ambos incluidos) y que no tienen ningún ingreso registrado. Con el primer escaneo dejan de contarse. "Hoy" es el día de Buenos Aires.


* **No se suma a la ocupación**, que solo cuenta a quienes ya entraron. Igual que la ocupación, un escaneo hecho sin conexión se descuenta recién cuando la PWA sincroniza.



### 9.6. Historial de Ingresos (Issue 26.6)

* `GET /api/v1/admin/ingresos` (`api/admin_ingresos.py` + `services/ingresos_admin_service.py`) devuelve los ingresos aceptados, del más nuevo al más viejo, paginados con `skip`/`limit` y con el total. Es de solo lectura y está separado del router transaccional de `bulk-sync`.


* **Días de Buenos Aires:** `limites_dias_negocio()` (`core/tiempo.py`) convierte el rango en un intervalo semiabierto, de las 00:00 del primer día a las 00:00 del día siguiente al último, con zona. Se compara contra la columna sin envolverla, así el corte cae en la medianoche argentina y se usa el índice.


* **Qué no muestra:** los QR rechazados por clonación nunca llegan a `ingresos_fisicos` (quedan en `conflictos_sincronizacion`), por eso no hace falta filtrarlos. Tampoco hay estado de sincronización: el servidor solo conoce lo que ya llegó, y la pantalla lo aclara.


* **Tipo de cliente:** con reserva, la misma regla que Gestión de reservas (`es_reserva_de_socio()`); en los manuales, socio si el DNI es de un socio activo.



## 10. Socios y Membresías

### 10.1. Baja lógica y vigencia

* Un socio no se borra: se da de baja con la columna `activo`. Así las reservas y los pagos siguen apuntando a la persona, la baja se puede deshacer ("Reactivar") y queda el historial.
* Son dos datos distintos: `activo` responde "¿la cuenta existe para el sistema?" y `membresia_vence` responde "¿la cuota está al día?".

| `activo` | Cuota | ¿Vale como socio? | ¿Puede iniciar sesión? |
|---|---|---|---|
| sí | al día (el día del vencimiento todavía vale) | sí | sí |
| sí | vencida o sin fecha | no (`CUOTA_VENCIDA`) | sí, para ver su estado |
| no | cualquiera | no (`NO_ES_SOCIO`) | no |

* **Una sola regla:** la vigencia se decide solo en `socio_service.py` (`membresia_vigente()` y `validar_socio()`), con la fecha de Buenos Aires. La usan la validación por DNI, `/auth/me`, el padrón y las reservas.
* **El descuento de socio lo decide el backend:** al crear una reserva, cada persona marcada como socia se valida con esa regla. Si no vale, se responde 422 con el DNI y el motivo, en vez de cobrarla como visitante sin avisar.
* **Editar no es lo mismo que renovar o dar de baja:** el `PUT` solo corrige datos personales. El vencimiento y la baja tienen sus propias operaciones, con sus reglas, para que nadie las saltee cambiando un campo.

### 10.2. Alta de socios (Issue 13.4)

* `POST /admin/socios` crea un usuario con rol `CLIENTE` y `is_socio = true`; el body no puede cambiar ninguno de los dos. La fecha `membresia_vence` es obligatoria: sin ella el socio nacería con la cuota vencida.
* Validaciones (`SocioCreate`): nombre de 2 a 100 caracteres, DNI de 7 u 8 dígitos (la misma regla que el frontend y las reservas), correo válido (`EmailStr`) y contraseña de 8 a 72 bytes.
* **La contraseña no se recorta:** el socio tiene que poder entrar con exactamente lo que cargó el administrador. El resto de los textos sí se recortan.
* Un DNI o un correo repetido responde 409. El correo se compara sin distinguir mayúsculas y se guarda en minúsculas. Si dos altas iguales llegan a la vez, la restricción única de la base frena a la segunda y también se responde 409.
* La lógica está en `services/alta_socio_service.py` y no en `socio_service.py`, para que `auth_service.py` pueda importar la regla de vigencia sin un import circular.

### 10.3. Búsqueda del padrón

* Un solo campo de búsqueda: si son números (con o sin puntos), busca DNI que empiecen así; si tiene letras, cada palabra tiene que aparecer en el nombre, en cualquier orden.
* No distingue acentos ni mayúsculas. Se usa `translate()` con la misma tabla de letras en Python y en SQL, sin la extensión `unaccent`, que pide permisos de superusuario.
* El texto viaja como parámetro (nunca pegado al SQL), con `%` y `_` escapados y un máximo de 100 caracteres. El filtrado lo hace la base.
* En el panel, la búsqueda espera 300 ms desde la última tecla (*debounce*) y descarta respuestas viejas que lleguen tarde.

## 11. Cancelaciones y Botón de Arrepentimiento (Issues 22 y 25)

Una reserva pagada se cancela de dos formas: el socio, desde Mis reservas (con sesión), o cualquier persona, con o sin cuenta, desde el "Botón de arrepentimiento" (con el email de la reserva). Las dos usan las mismas reglas y la misma función de cancelación (`services/cancelacion_service.py`).

### 11.1. Reglas de Cancelación

Primero se mira el plazo de arrepentimiento; si no rige, se aplican las reglas que configura el administrador en el panel (Configuración → Cancelaciones: días de anticipación y porcentaje de devolución).

| Situación | ¿Se puede cancelar? | Devolución |
|---|---|---|
| Dentro de los `ARREPENTIMIENTO_DIAS` (10) corridos desde la reserva **y** antes del día de ingreso | Siempre | 100 % |
| Fuera de esa ventana, hasta N días antes del ingreso (N configurado; 0 = hasta el mismo día) | Sí | El porcentaje configurado (el monto se redondea hacia abajo, al centavo) |
| Fuera de esa ventana y después del plazo del camping | No (422 "Lo sentimos, las reservas solo se pueden cancelar hasta N días antes del ingreso.") | — |

* **Base legal del arrepentimiento:** el art. 34 de la Ley 24.240 da 10 días corridos para revocar una compra a distancia sin costo, y la Disposición 954/2025 obliga a ofrecer un "Botón de arrepentimiento" visible y usable sin registrarse. Para servicios turísticos con fecha determinada, hay que avisar al menos 24 horas antes del inicio; el sistema lo aplica como "hasta el día anterior al ingreso". El arrepentimiento está por encima de la configuración del camping.
* **Cómputo de días:** el día de la reserva no cuenta. Una reserva del 1/11 se puede cancelar por arrepentimiento hasta el 11/11 inclusive (si el ingreso es después del 12/11).
* **Zona horaria:** `fecha_reserva` se guarda en UTC sin zona. Antes de comparar se pasa a la fecha de Buenos Aires con `a_zona_negocio()` (ver [Manejo de zonas horarias](./zonas-horarias.md)): una reserva hecha a las 22 h en Argentina ya es del día siguiente en UTC.
* **Lo que el arrepentimiento no habilita:** siguen sin poder cancelarse las reservas ya canceladas, en alerta de clonación, sin pagar o con un ingreso registrado.
* **Respuesta:** `GET /reservas/{id}/cancelacion` informa `arrepentimiento: true` cuando rige; en ese caso `fecha_limite` es el último día del arrepentimiento y la pantalla lo explica ("Estás dentro del plazo de arrepentimiento: se te devuelve el total.").

### 11.2. Cancelación y Devolución

* **Búsqueda separada de la cancelación:** `cancelar_reserva()` recibe la reserva ya encontrada. Mis reservas la busca por dueño (`reserva_del_usuario`) y el botón de arrepentimiento por el enlace del correo. Así hay una sola implementación de la regla, del reembolso y del correo.
* **Sin devoluciones dobles:** `cancelar_reserva()` bloquea la fila (`SELECT … FOR UPDATE`) y la vuelve a leer antes de evaluar. Si llegan dos pedidos a la vez, o se usa dos veces el mismo enlace, el segundo encuentra la reserva cancelada y responde 422 "La reserva ya está cancelada.".
* **Efectos:** la reserva pasa a `CANCELADA` (libera el cupo y su id entra en la lista negra que la PWA usa para rechazar el QR sin internet); el pago sigue `PAGADO` y la devolución se registra en `pagos` (`monto_devuelto`, `fecha_devolucion`, `devolucion_estado`). Si Mercado Pago rechaza el reembolso, la reserva igual queda cancelada y el pago queda en `pendiente_revision` (la misma marca usa el pago tardío sin cupo de la Issue 17.5).
* **Por qué el pago sigue `PAGADO`:** después de una devolución parcial Mercado Pago vuelve a avisar el pago como aprobado. Si la reserva quedara en `CANCELADO`, la confirmación de pagos la volvería a confirmar; con `PAGADO` ese aviso se ignora.
* **Reembolso:** con el 100 % se pide la devolución total (Mercado Pago marca el pago como `refunded`); con menos, solo el monto (`{"amount": ...}`); con 0 % no se llama a Mercado Pago.
* **Correo:** el de cancelación indica el motivo (Mis reservas o botón de arrepentimiento), si se aplicó el arrepentimiento y un **código de gestión**, que es el id de la reserva.

### 11.3. Enlaces del Botón de Arrepentimiento (sin cuenta)

* **Solo el email:** `POST /arrepentimiento/solicitud` busca las reservas pagadas, confirmadas y con ingreso de hoy en adelante de ese email (sin distinguir mayúsculas) y manda **un correo con un enlace por reserva**. Así quien tiene varias elige cuál cancelar, y cada una tiene su propia confirmación.
* **No revela datos:** responde siempre 202 con el mismo mensaje, haya o no reservas; el correo sale en segundo plano.
* **Token del enlace:** JWT HS256 firmado con `ARREPENTIMIENTO_SECRET_KEY` (distinta de la de sesión), con `sub` (id de una sola reserva), `email`, `purpose = "arrepentimiento"` y vencimiento (`ARREPENTIMIENTO_TOKEN_MINUTOS`, 60). Al usarlo se verifican firma, vencimiento y propósito, y que la reserva exista y tenga ese email.
* **Por qué un enlace por correo:** sabiendo solo el email de otra persona no se puede cancelar su reserva, porque el enlace llega únicamente a su casilla. Cambiar el id dentro del token invalida la firma.
* **Errores:** enlace vencido → 401 "El enlace venció. Pedí uno nuevo desde el botón de arrepentimiento."; alterado, de otro propósito o de otra reserva → 401 "El enlace no es válido. Pedí uno nuevo desde el botón de arrepentimiento.".
* **Correo del QR:** incluye el enlace a `/arrepentimiento`, armado con `FRONTEND_URL`.

### 11.4. Pantallas (Web de Reservas)

* En Mis reservas, el botón "Cancelar" aparece en todas las reservas próximas y abre `components/DialogoCancelacion.tsx` (Dialog de `radix-ui`: se cierra con Esc y mantiene el foco adentro). Pide las condiciones a `GET /reservas/{id}/cancelacion`; fuera de plazo muestra el mensaje del backend y solo "Volver". Al confirmar, la reserva pasa a "Canceladas" con la respuesta del `POST`, sin volver a pedir la lista, y arriba se muestra el resultado.
* El enlace "Botón de arrepentimiento" está en el pie de `LayoutPublico`, así que aparece en todas las pantallas de la web, con o sin sesión.
* `/arrepentimiento` (`pages/Arrepentimiento.tsx`) pide solo el email y luego muestra "Si hay reservas con ese email, te enviamos un correo con un enlace para cada una.".
* `/cancelar-reserva?token=` (`pages/CancelarReserva.tsx`) muestra las condiciones y confirma, con estados de carga, enlace vencido o no válido, fuera de plazo, éxito (con el código de gestión) y error. Las condiciones se dibujan con `DetalleCondiciones`, el mismo componente del diálogo de Mis reservas.
* Las llamadas están en `lib/arrepentimiento.ts` y no reutilizan las de Mis reservas: ahí un 401 cierra la sesión, y acá significa "enlace vencido".

### 11.5. Fuentes

* Ley 24.240 de Defensa del Consumidor, art. 34 (revocación de la aceptación en 10 días corridos).
* Disposición 954/2025 de la Subsecretaría de Defensa del Consumidor y Lealtad Comercial (Botón de Arrepentimiento; servicios turísticos con fecha determinada: aviso 24 horas antes). Boletín Oficial: https://www.boletinoficial.gob.ar/detalleAviso/primera/330827/20250904
* Código Civil y Comercial de la Nación, art. 6 (los plazos de días se cuentan desde el día siguiente). Citado sin consultar el texto oficial: conviene verificarlo.

> La regla se implementó a partir de estas normas, pero no es asesoramiento legal: conviene que la valide alguien con formación jurídica.

## 12. Calidad de Software (QA), Pruebas y Cobertura

Se consolidó un esfuerzo masivo de aserción elevando la calidad técnica de las bases estructurales.

### 12.1. Pruebas de Backend (`pytest`)

* Se desarrollaron tests asíncronos configurando `AnyIO` y evadiendo errores de integridad referencial inyectando usuarios efímeros pre-reservas en GitHub Actions.


* **Corrección Crítica (`conflictos.py`):** Durante el QA se detectó que la tabla de auditoría de conflictos carecía del modelo `declarative_base` (`core.database.Base`) y poseía errores de tipo (Integer vs UUID). Fue corregido y empujado en la migración `7224388d1b53`.


* La cobertura general subió del 78.11% al 91.11% testeando a fondo el endpoint masivo `/bulk-sync` y la paginación de `/bootstrap`.



### 12.2. Pruebas de Frontend (`vitest`)

* Se utilizó la dependencia de desarrollo `fake-indexeddb` para someter a prueba a Dexie fuera del navegador.


* **Criptografía Aislada:** Se crearon tests simulando interceptaciones (*tampering*); ejemplo: extrayendo un token, alterando `cantidad_personas` de 2 a 5, y volviéndolo a armar sin la firma correcta. La librería lo rechaza efectivamente.


* **Ordenamiento FIFO:** Se parchó un comportamiento indeseado donde IndexedDB leía prioridades basándose en claves autoincrementales, corrigiendo el código de producción a un orden cronológico absoluto (`a.fecha_escaneo.getTime() - b.fecha_escaneo.getTime()`).


* Se simularon caídas de `navigator.onLine`, validando intercepciones transparentes mediante `try/catch` sin generar cierres de aplicación inesperados.


### 12.3. Pruebas de punta a punta (Playwright)

* `npm run test:e2e` levanta una base `_e2e` limpia, el backend, el build de la PWA y un Mercado Pago y un Resend falsos, y recorre el sistema con varios navegadores a la vez (cliente o socio, guardia y administrador).
* Cubren el recorrido feliz, el trabajo del guardia sin conexión, la cancelación hasta el rechazo del QR en la puerta y un visitante sin cuenta que cancela una de sus dos reservas con el botón de arrepentimiento. Las decisiones y la forma de correrlas están en la [Guía de Pruebas](./testing_guide.md), secciones 3.3 a 3.5.1.
