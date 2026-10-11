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


* Descarga también la configuración: aforo máximo (`CAMPING_TOTAL_CAPACITY`, 50 por defecto) y margen offline (`CAMPING_OFFLINE_BUFFER`, 5 por defecto).



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



## 8. Calidad de Software (QA), Pruebas y Cobertura

Se consolidó un esfuerzo masivo de aserción elevando la calidad técnica de las bases estructurales.

### 8.1. Pruebas de Backend (`pytest`)

* Se desarrollaron tests asíncronos configurando `AnyIO` y evadiendo errores de integridad referencial inyectando usuarios efímeros pre-reservas en GitHub Actions.


* **Corrección Crítica (`conflictos.py`):** Durante el QA se detectó que la tabla de auditoría de conflictos carecía del modelo `declarative_base` (`core.database.Base`) y poseía errores de tipo (Integer vs UUID). Fue corregido y empujado en la migración `7224388d1b53`.


* La cobertura general subió del 78.11% al 91.11% testeando a fondo el endpoint masivo `/bulk-sync` y la paginación de `/bootstrap`.



### 8.2. Pruebas de Frontend (`vitest`)

* Se utilizó la dependencia de desarrollo `fake-indexeddb` para someter a prueba a Dexie fuera del navegador.


* **Criptografía Aislada:** Se crearon tests simulando interceptaciones (*tampering*); ejemplo: extrayendo un token, alterando `cantidad_personas` de 2 a 5, y volviéndolo a armar sin la firma correcta. La librería lo rechaza efectivamente.


* **Ordenamiento FIFO:** Se parchó un comportamiento indeseado donde IndexedDB leía prioridades basándose en claves autoincrementales, corrigiendo el código de producción a un orden cronológico absoluto (`a.fecha_escaneo.getTime() - b.fecha_escaneo.getTime()`).


* Se simularon caídas de `navigator.onLine`, validando intercepciones transparentes mediante `try/catch` sin generar cierres de aplicación inesperados.