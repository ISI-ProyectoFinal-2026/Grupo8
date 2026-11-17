# Documentación Técnica 

Este documento centraliza las decisiones de arquitectura, el diseño de la base de datos, los motores de validación criptográfica y la topología de la infraestructura de Qamp. El sistema opera bajo un enfoque B2B2C, separando la lógica de software de la oferta física del camping.

## 1. Arquitectura de Despliegue e Integración Continua (CI/CD)

El sistema está orquestado mediante un pipeline de CI/CD configurado en GitHub Actions (`.github/workflows/test.yml`) que exige una cobertura mínima de código del 80%.

### 1.1. Frontend (Vercel)

* **Alojamiento y Compilación:** La Progressive Web App (PWA) se aloja en Vercel, apuntando el directorio raíz a `frontend/pwa-acceso` para aislar el entorno de Vite dentro del monorepo.


* **Punto de Entrada:** Se validó la trazabilidad desde `src/main.tsx` y la compilación es automatizada mediante Node.js (v20.19.0) y Vite.


* **Gestión de Claves:** La clave pública asimétrica (`VITE_PUBLIC_KEY`) requerida para verificar los QR se inyecta de forma segura a través del dashboard de Vercel.


* **Gatillos de Despliegue:** Se configuraron webhooks para ejecutar redespliegues automáticos ante integraciones exitosas en la rama `main`.



### 1.2. Backend (Render)

* **Entorno y Configuración:** El servidor API REST (FastAPI) está alojado en Render apuntando al directorio `backend` y forzando el entorno a Python 3.13.7 mediante variables de entorno, respetando el `Pipfile.lock`.


* **Inicialización:** El comando de arranque es `pipenv run uvicorn main:app --host 0.0.0.0 --port 10000`, exponiendo además un endpoint de salud (`/health`).


* **Secretos (Fail-Fast):** El archivo `core/config.py` usa `pydantic-settings` para abortar el arranque de FastAPI inmediatamente si faltan variables esenciales (como `POSTGRES_*` o `JWT_PRIVATE_KEY`). Todos los secretos están encriptados en el hardware virtual de Render, ignorando el `.env` en el control de versiones.



## 2. Capa de Datos, Modelos y ORM

La base de datos relacional PostgreSQL administra las transacciones del sistema con un diseño centrado en la integridad y la trazabilidad.

### 2.1. Conexión y Motor

* **Infraestructura Base:** El módulo `core/database.py` utiliza SQLAlchemy con `create_engine` conectado al puerto local 5435 (para evitar bloqueos con servicios de Windows), utilizando el driver sincrónico `psycopg2-binary`.


* **Gestión de Sesiones:** Se emplea `sessionmaker` con las propiedades `autocommit=False` y `autoflush=False` para un control fino sobre el ciclo de transacciones.



### 2.2. Entidades Principales

* **Modelo Usuario (`models/user.py`):** Utiliza UUID como identificador único principal. Incluye atributos clave como correo electrónico, hash de contraseña, DNI, indicador de membresía (`is_socio`), marcas de auditoría (`created_at`, `updated_at`) y un rol de sistema basado en `RoleEnum` (Admin, Seguridad, Cliente).


* **Modelo Reserva (`models/reserva.py`):** Almacena el ID (`UUID`), una clave foránea (`user_id`), fecha y hora, cantidad de personas y el `jwt_jti` (identificador único para el código QR). Controla su avance mediante `EstadoPagoEnum` (Pendiente, Pagado, Cancelado).



### 2.3. Control de Versiones y Seeding

* **Migraciones:** Alembic mantiene la sincronización entre SQLAlchemy y la base de datos. La revisión automática `f30ae74360fe_initial_schema.py` tradujo los modelos ORM a instrucciones DDL, aplicables con el comando `alembic upgrade head`.


* **Inicialización de Datos (`seed.py`):** Este script resetea tablas relacionales de manera inversa (primero reservas, luego usuarios) y genera automáticamente un Administrador, personal de Seguridad y cinco usuarios de prueba junto con 15 registros de reservas mixtas (pasadas y futuras) para visualizar métricas.



## 3. Core de Negocio y Seguridad de Endpoints

El núcleo (FastAPI) está organizado de forma modular (`api/`, `core/`, `models/`, `schemas/`, `services/`, `security/`).

### 3.1. Motores Internos

* **Capacidad (`services/capacity_service.py`):** Audita el aforo del camping devolviendo un error HTTP 400 si las peticiones superan el límite máximo establecido.
  * `lugares_ocupados` calcula cuántos lugares están ocupados en las fechas pedidas. Ocupan cupo las reservas confirmadas, finalizadas y en alerta de clonación, y las `PENDIENTE` que están dentro del plazo `RESERVA_PENDIENTE_TTL_MINUTES` (10 minutos por defecto, configurable en el `.env`). No ocupan cupo las `CANCELADA` ni las `PENDIENTE` más antiguas que ese plazo. `cancelar_reservas_vencidas` pasa esas pendientes a `CANCELADA` al crear y al consultar reservas. Una pendiente que cumple justo el plazo todavía cuenta.
  * `check_availability` compara lo ocupado más el margen offline contra la capacidad total. `crear_reserva` solo invoca estos dos métodos.


* **Tarifas (`services/pricing_service.py`):** Algoritmo de *pricing* dinámico que determina el costo final basado en la cantidad de huéspedes declarados.


* **Endpoints Transaccionales (`api/reservas.py`):** Emplean Pydantic (`ReservaCreate` y `ReservaResponse`) para la serialización estricta de entrada y salida.



### 3.2. Middleware de Autenticación

* **RBAC (Control de Acceso Basado en Roles):** Se blindan rutas (como `GET /reservas/`) requiriendo tokens JWT asíncronos mediante `OAuth2PasswordBearer`.


* La dependencia `get_current_user` verifica el atributo `sub` del token y confirma la existencia del usuario en PostgreSQL, mientras que `require_role` valida los permisos administrativos.


* Este token de sesión interno se firma con el algoritmo simétrico HS256 utilizando `AUTH_SECRET_KEY`.


* **Usuarios dados de baja:** un JWT no se puede anular, pero el backend busca al usuario en cada petición. Si está inactivo responde 401, así que una sesión abierta deja de valer en la petición siguiente, sin lista de tokens revocados. En el login, el inactivo se rechaza después de comprobar la contraseña, con el mismo "Credenciales inválidas", para no revelar si la cuenta existe.



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

La PWA emplea IndexedDB envuelta en promesas con la librería Dexie.js (archivo `dbService.ts`), estructurada en *stores*: `configuracion`, `ingresos_pendientes` y `historial`.

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


* **QR clonado (doble gasto offline):** la columna `jti` es única, así que la base es el árbitro final, incluso con dos pedidos simultáneos. El mismo `jti` desde el mismo `dispositivo_id` es un reintento de red; desde otro dispositivo es un clon: el primero que llegó queda como ingreso, el segundo se guarda en `conflictos_sincronizacion` y la reserva pasa a `ALERTA_CLONACION`. No se expulsa a nadie automáticamente, porque el titular real puede ser el que sincronizó segundo: decide un administrador.


* **La alerta no se puede pisar:** el estado de la reserva solo cambia por métodos del modelo que se niegan a tocar una reserva en alerta, y la fila se bloquea (`SELECT ... FOR UPDATE`). Un pago que llega durante la alerta se registra, pero no confirma ni cancela la reserva.


* **Resolución:** al entrar en alerta se guarda el estado anterior (`estado_antes_alerta`). Cuando el administrador resuelve el incidente, la reserva vuelve a ese estado, ajustado al pago actual, y queda una fila de auditoría en `resoluciones_alerta` con quién resolvió y cuándo.


* **Hora del escaneo:** se guarda la hora en que se escaneó, no la de la sincronización, en UTC (`timestamptz`). El sistema confía en el reloj del celular del guardia; ver [zonas-horarias.md](./zonas-horarias.md).



## 6. Módulo de Pagos y Reconciliación Transaccional

La integración oficial con Mercado Pago gestiona todo el ciclo financiero en `services/payment_service.py` y `api/payments.py`.

### 6.1. Generación de Orden y Webhooks

* El método `POST /api/payments/create` envía las preferencias al SDK vinculando el UUID local mediante el parámetro `external_reference`. Define también las `back_urls` (éxito, fallo, pendiente) y la `notification_url`.


* El webhook transaccional (`POST /api/payments/webhook`) mitiga vulnerabilidades de suplantación de origen (*spoofing*) consumiendo activamente `payment().get()` antes de ejecutar el `db.commit()` que cambia el estado a `PAGADO`.



### 6.2. Auditoría y Contingencia de Huérfanas

* En caso de pérdida de webhooks (fallo de servidor o red), se implementó el endpoint contingente `GET /api/payments/reconcile/{reserva_id}`. Usa el filtro `.search()` de Mercado Pago sobre el `external_reference` para asentar cobros ignorados.


* En desarrollo con `localhost`, Mercado Pago desactiva intencionalmente el redireccionamiento `auto_return: "approved"`, lo cual obliga a probar las pantallas en React (`PagoExito.tsx` y `PagoRechazado.tsx`) de forma manual hasta su despliegue HTTPS.



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


* **Pantallas actuales:** Inicio (monitor de ocupación, personas esperadas y resumen de cobros), Gestión de reservas, Socios, Descuentos, Incidentes, Egresos, Alertas, Tipos de reserva y Configuración. Las entradas con `alPie: true` (hoy, Configuración) se muestran al final del menú, encima de "Cerrar sesión".


* **Instalable (Issue 23.1):** el panel se puede instalar como app separada de la del guardia. Mientras está abierto, `hooks/useManifest.ts` cambia el manifest de la página por `public/manifest-admin.webmanifest` ("Qamp Admin", `start_url` y `scope` en `/admin/`). El service worker sigue siendo uno solo para todo el sitio.



### 8.3. Formulario de Reserva

* **Personas:** Se piden los datos de cada persona y se envía la lista completa al crear la reserva.


* **Total:** Sale siempre de `POST /reservas/cotizar`; el frontend no tiene precios ni descuentos propios.


* **Socios:** El DNI de cada persona marcada como socio se verifica con `GET /socios/validar/{dni}`. Si el DNI no existe, no es de un socio o tiene la cuota vencida, la reserva se bloquea. Si quien reserva es un socio con sesión, sus datos aparecen precargados.


* **Correo:** Se pide confirmar el email (no se puede pegar en ese campo) para evitar errores al enviar el QR. Si el email sale de la cuenta con sesión, no se pide confirmarlo. Es una validación solo del frontend: el backend recibe un único email.



### 8.4. Gestión de Reservas (Issue 23.3)

* La pantalla del panel lista todas las reservas con `GET /reservas/` y abre el detalle con `GET /reservas/{id}` (personas, tipo de reserva, pagos de Mercado Pago y si ya ingresó). Es solo de consulta: no modifica reservas.


* **Filtros y paginación en el backend:** estado de pago, estado de la reserva, rango de fechas de ingreso, socio o visitante y un campo de búsqueda. La respuesta trae `total` e `items`, y el panel pide de a 20.


* **Búsqueda:** por titular (cada palabra, en cualquier orden), email o comienzo del número de reserva (con o sin `#`), sin importar acentos ni mayúsculas. Reutiliza la misma tabla de letras que la búsqueda del padrón de socios (ver 10.2). La lógica vive en `services/reservas_admin_service.py`.


* **Socio o visitante:** una reserva es "de socio" si la hizo una cuenta con sesión o si el titular se cargó como socio. La misma regla se usa en el filtro (SQL) y en el campo `tipo_cliente` de la respuesta, para que nunca den resultados distintos.



### 8.5. Estilo Común (Issue 24.5)

* Las tres apps comparten colores, tipografía y componentes. Todo se define en `src/index.css` (variables) y `tailwind.config.js` (escalas `tierra` y `bosque`); las pantallas no usan colores sueltos. La guía completa, con el contraste verificado de cada combinación, está en [ux-ui/estilo.md](./ux-ui/estilo.md).


* **Marca:** el panel y la PWA dicen "Qamp". La web de reservas muestra el nombre y los datos de contacto del camping que contrató el sistema, tomados de las variables `VITE_CAMPING_*` del `.env` del frontend (`src/lib/camping.ts`), así se adapta a otro camping sin tocar código.


* **PWA del guardia:** `components/layout/LayoutAcceso.tsx` arma una barra superior (menú ☰ con el estado de sincronización y "Cerrar sesión", título e indicador Online/Offline) y una barra inferior con Historial (`/acceso/historial`), Escáner (`/acceso`) y Registro manual (`/acceso/manual`).


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


* **Mercado Pago:** Solo los pagos aprobados de la tabla `pagos`, en el día de la aprobación. Un reembolso cambia el estado del pago y deja de contarse.


* **Días:** Se agrupa por día de Buenos Aires, no de UTC, para que un cobro a las 23:30 cuente en el día correcto.



### 9.4. Monitor del Panel

* El Inicio muestra la ocupación sobre la capacidad, el porcentaje y el tramo de la barra reservado al buffer offline. Se actualiza cada 30 segundos y al registrar un egreso.


* **Colores:** Verde por debajo del 70 %, amarillo desde el 70 % y rojo desde el 90 % (`lib/ocupacion.ts`). El nivel también se muestra en texto ("normal", "alta", "crítica").


* Debajo del monitor está el resumen de cobros, con la última semana por defecto y un rango elegible de hasta 92 días.



### 9.5. Personas Esperadas (Issue 23.2)

* Junto al monitor, el Inicio muestra cuántas reservas y personas se esperan hoy y todavía no llegaron (`GET /api/v1/admin/esperados`).


* **Qué cuenta:** reservas pagadas y no canceladas cuya estadía incluye hoy (del ingreso al egreso, ambos incluidos) y que no tienen ningún ingreso registrado. Con el primer escaneo dejan de contarse. "Hoy" es el día de Buenos Aires.


* **No se suma a la ocupación**, que solo cuenta a quienes ya entraron. Igual que la ocupación, un escaneo hecho sin conexión se descuenta recién cuando la PWA sincroniza.



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

### 10.2. Búsqueda del padrón

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
* **Efectos:** la reserva pasa a `CANCELADA` (libera el cupo y su id entra en la lista negra que la PWA usa para rechazar el QR sin internet); el pago sigue `PAGADO` y la devolución se registra en `pagos` (`monto_devuelto`, `fecha_devolucion`, `devolucion_estado`). Si Mercado Pago rechaza el reembolso, la reserva igual queda cancelada y el pago queda en `pendiente_revision`.
* **Correo:** el de cancelación indica el motivo (Mis reservas o botón de arrepentimiento), si se aplicó el arrepentimiento y un **código de gestión**, que es el id de la reserva.

### 11.3. Enlaces del Botón de Arrepentimiento (sin cuenta)

* **Solo el email:** `POST /arrepentimiento/solicitud` busca las reservas pagadas, confirmadas y con ingreso de hoy en adelante de ese email (sin distinguir mayúsculas) y manda **un correo con un enlace por reserva**. Así quien tiene varias elige cuál cancelar, y cada una tiene su propia confirmación.
* **No revela datos:** responde siempre 202 con el mismo mensaje, haya o no reservas; el correo sale en segundo plano.
* **Token del enlace:** JWT HS256 firmado con `ARREPENTIMIENTO_SECRET_KEY` (distinta de la de sesión), con `sub` (id de una sola reserva), `email`, `purpose = "arrepentimiento"` y vencimiento (`ARREPENTIMIENTO_TOKEN_MINUTOS`, 60). Al usarlo se verifican firma, vencimiento y propósito, y que la reserva exista y tenga ese email.
* **Por qué un enlace por correo:** sabiendo solo el email de otra persona no se puede cancelar su reserva, porque el enlace llega únicamente a su casilla. Cambiar el id dentro del token invalida la firma.
* **Errores:** enlace vencido → 401 "El enlace venció. Pedí uno nuevo desde el botón de arrepentimiento."; alterado, de otro propósito o de otra reserva → 401 "El enlace no es válido. Pedí uno nuevo desde el botón de arrepentimiento.".
* **Correo del QR:** incluye el enlace a `/arrepentimiento`, armado con `FRONTEND_URL`.

### 11.4. Pantallas (Web de Reservas)

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
