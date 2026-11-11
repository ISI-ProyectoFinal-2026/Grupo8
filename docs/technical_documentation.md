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
  * `lugares_ocupados` calcula cuántos lugares están ocupados en las fechas pedidas. Ocupan cupo las reservas confirmadas, finalizadas y en alerta de clonación, y las `PENDIENTE` que están dentro del plazo `RESERVA_PENDIENTE_TTL_MINUTES` (30 minutos por defecto, configurable en el `.env`). No ocupan cupo las `CANCELADA` ni las `PENDIENTE` más antiguas que ese plazo (abandonadas); estas últimas no se borran ni se cancelan, solo dejan de contar. Una pendiente que cumple justo el plazo todavía cuenta.
  * `check_availability` compara lo ocupado más el margen offline contra la capacidad total. `crear_reserva` solo invoca estos dos métodos.


* **Tarifas (`services/pricing_service.py`):** Algoritmo de *pricing* dinámico que determina el costo final basado en la cantidad de huéspedes declarados.


* **Endpoints Transaccionales (`api/reservas.py`):** Emplean Pydantic (`ReservaCreate` y `ReservaResponse`) para la serialización estricta de entrada y salida.



### 3.2. Middleware de Autenticación

* **RBAC (Control de Acceso Basado en Roles):** Se blindan rutas (como `GET /reservas/`) requiriendo tokens JWT asíncronos mediante `OAuth2PasswordBearer`.


* La dependencia `get_current_user` verifica el atributo `sub` del token y confirma la existencia del usuario en PostgreSQL, mientras que `require_role` valida los permisos administrativos.


* Este token de sesión interno se firma con el algoritmo simétrico HS256 utilizando `AUTH_SECRET_KEY`.



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

* Antes del turno, el frontend consume `GET /api/v1/sincronizacion/bootstrap`, descargando paginada la lista de reservas canceladas en las últimas 72 horas (parámetros `page` y `limit=1000`).


* Descarga también la configuración guardada desde el panel: aforo máximo (50 por defecto) y margen offline en personas (10 % de la capacidad, redondeado hacia arriba: 5 por defecto).



### 5.2. Control de Aforo Local y Transacciones ACID

* Al detectar un QR válido, la base local realiza una transacción indivisible (ACID): revisa si el identificador `jti` ya existe en `ingresos_pendientes` para evitar lectura múltiple, suma la cantidad de personas al aforo local y registra el ticket. Si la lectura excede la capacidad o la transacción falla por error de hardware, Dexie ejecuta un *rollback* de los datos.



### 5.3. Background Sync y Sincronización

* El archivo `syncService.ts` escucha el evento `online` en `window`.


* Las entradas se leen en orden FIFO absoluto según la marca temporal `fecha_escaneo.getTime()` y se despachan en lote hacia `POST /api/v1/ingresos/bulk-sync`.


* Se emplea un mecanismo de mitigación de red intermitente mediante *Backoff Exponencial* (reintentos con retrasos de 5s, 15s y 45s).


* En caso de conflictos (ej. un mismo QR validado por dos guardias distintos y enviado simultáneamente), el backend asienta el primer `IngresoFisico` y deposita el segundo en la tabla `ConflictosSincronizacion` sin colgar la cola. Retorna los `sincronizados_jti` para que el frontend limpie su *store* selectivamente (`bulkDelete`).



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


* Utiliza plantillas `Jinja2` modulares (`confirmacion_reserva.html`, `recibo_pago.html`, `cancelacion_reserva.html`) inyectando estilos CSS integrados (*inline*).


* La credencial se inserta directamente en el HTML referenciándola mediante un identificador de contenido (CID) como `cid:qr_code`.



### 7.3. Asincronía y Tareas en Segundo Plano

* FastAPI responde instantáneamente un `200 OK` al Webhook de Mercado Pago para evitar cancelaciones automáticas.


* El ensamblaje del PNG, compilado en Jinja2 y envío a Resend, es derivado a un hilo secundario empleando la funcionalidad nativa `BackgroundTasks`.


* El flujo cuenta con idempotencia: si el webhook notifica dos veces un cobro aprobado, el orquestador ignora la segunda alerta evitando duplicar envíos.



## 8. Web de Reservas y Panel de Administración (Frontend)

Las pantallas del cliente, la PWA del guardia y el panel del administrador conviven en la misma aplicación de React (`frontend/pwa-acceso`) y comparten una única sesión.

### 8.1. Sesión y Rutas por Rol

* **Sesión:** `context/AuthContext.tsx` guarda el token de `POST /auth/login` en `localStorage` (`qamp_token`) y lee el rol del claim `rol`. Ese rol solo decide qué se muestra: el backend vuelve a validar el rol en cada request.


* **Redirección:** Después del login, cada rol va a su pantalla (`RUTA_POR_ROL` en `lib/auth.ts`): `SEGURIDAD` a `/acceso`, `ADMIN` a `/admin` y `CLIENTE` a `/perfil`. El menú del `Header` cambia según el rol.


* **Sesión vencida:** Cuando una pantalla recibe un 401, dispara el evento `AUTH_EXPIRED_EVENT` y el contexto cierra la sesión. La excepción es el guardia: si su token vence sin conexión, la sesión se conserva para que pueda seguir escaneando, y se le pide iniciar sesión cuando `bulk-sync` responde 401 al volver la red.


* **Guards:** `RutaProtegida` deja pasar solo a los roles indicados (sin sesión redirige a `/login`; con otro rol muestra "Acceso denegado"). `RutaSocio` consulta `GET /auth/me` y limita "Perfil" y "Mis reservas" a los socios; un socio con la cuota vencida entra igual para ver su estado.



### 8.2. Panel de Administración

* **Estructura:** `/admin/*` está protegido para `ADMIN` en `pages/admin/AdminRoutes.tsx` y usa un layout común con el menú lateral.


* **Agregar una pantalla:** Cada pantalla se registra con una entrada en `pages/admin/routes.tsx` (`path`, `titulo`, `icono`, `element`). El menú y las rutas se arman a partir de esa lista, por lo que no hace falta tocar `App.tsx` ni el layout.


* **Pantallas actuales:** Inicio (monitor de ocupación y resumen de cobros), Socios, Descuentos, Incidentes, Egresos y Alertas.



### 8.3. Formulario de Reserva

* **Personas:** Se piden los datos de cada persona y se envía la lista completa al crear la reserva.


* **Total:** Sale siempre de `POST /reservas/cotizar`; el frontend no tiene precios ni descuentos propios.


* **Socios:** El DNI de cada persona marcada como socio se verifica con `GET /socios/validar/{dni}`. Si el DNI no existe, no es de un socio o tiene la cuota vencida, la reserva se bloquea. Si quien reserva es un socio con sesión, sus datos aparecen precargados.


* **Correo:** Se pide confirmar el email (no se puede pegar en ese campo) para evitar errores al enviar el QR. Si el email sale de la cuenta con sesión, no se pide confirmarlo. Es una validación solo del frontend: el backend recibe un único email.



## 9. Ocupación, Egresos y Cobros

Permite al administrador saber cuántas personas hay dentro del camping y cuánto se cobró. La lógica vive en `services/ocupacion_service.py` y `services/cobros_service.py`.

### 9.1. Cálculo de la Ocupación

* **Fórmula:** Personas de los ingresos aceptados menos personas egresadas. Se cuentan todos los movimientos y no solo los del día, porque hay estadías de varias noches.


* **Personas por ingreso:** Los ingresos con QR guardan la cantidad que trae el token y los manuales la que anota el guardia. Los registros anteriores sin cantidad cuentan como 1 persona.


* **QR clonados:** No suman, porque el segundo escaneo de un mismo `jti` queda en `conflictos_sincronizacion` y nunca llega a `ingresos_fisicos`.


* **Nunca negativa:** Si se registran egresos antes de que lleguen los ingresos offline, la ocupación queda en 0 hasta que los guardias sincronicen.


* **Capacidad y buffer:** Salen de `configuracion_camping`, que el administrador edita desde el panel (Issue 19.1). El buffer se guarda como porcentaje y se informa en personas, redondeado hacia arriba.



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



## 10. Calidad de Software (QA), Pruebas y Cobertura

Se consolidó un esfuerzo masivo de aserción elevando la calidad técnica de las bases estructurales.

### 10.1. Pruebas de Backend (`pytest`)

* Se desarrollaron tests asíncronos configurando `AnyIO` y evadiendo errores de integridad referencial inyectando usuarios efímeros pre-reservas en GitHub Actions.


* **Corrección Crítica (`conflictos.py`):** Durante el QA se detectó que la tabla de auditoría de conflictos carecía del modelo `declarative_base` (`core.database.Base`) y poseía errores de tipo (Integer vs UUID). Fue corregido y empujado en la migración `7224388d1b53`.


* La cobertura general subió del 78.11% al 91.11% testeando a fondo el endpoint masivo `/bulk-sync` y la paginación de `/bootstrap`.



### 10.2. Pruebas de Frontend (`vitest`)

* Se utilizó la dependencia de desarrollo `fake-indexeddb` para someter a prueba a Dexie fuera del navegador.


* **Criptografía Aislada:** Se crearon tests simulando interceptaciones (*tampering*); ejemplo: extrayendo un token, alterando `cantidad_personas` de 2 a 5, y volviéndolo a armar sin la firma correcta. La librería lo rechaza efectivamente.


* **Ordenamiento FIFO:** Se parchó un comportamiento indeseado donde IndexedDB leía prioridades basándose en claves autoincrementales, corrigiendo el código de producción a un orden cronológico absoluto (`a.fecha_escaneo.getTime() - b.fecha_escaneo.getTime()`).


* Se simularon caídas de `navigator.onLine`, validando intercepciones transparentes mediante `try/catch` sin generar cierres de aplicación inesperados.