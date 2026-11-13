# Guía de Despliegue e Infraestructura 

Esta guía documenta la infraestructura en la nube, el flujo de Integración y Despliegue Continuo (CI/CD), y los pasos necesarios para levantar los entornos locales y de producción de Qamp. 

## 1. Requisitos Previos y Entorno Local

Para inicializar y probar el proyecto en un entorno de desarrollo, el sistema host debe contar con las siguientes herramientas instaladas:

* Python 3.11 y el gestor de entornos virtuales Pipenv.
* Node.js y npm para compilar y ejecutar el entorno de desarrollo Frontend y la PWA.
* Docker Desktop para la orquestación de la base de datos PostgreSQL en contenedores locales.


### 1.1. Inicialización Local del Backend

* **Instalación:** Dentro del directorio clonado, se deben instalar las dependencias con `pipenv install --dev`.
* **Variables de Entorno:** Se requiere configurar un archivo `.env` tomando `.env.example` como referencia. Es crucial mantener el puerto de base de datos en 5435 para evitar conflictos con otros servicios locales de PostgreSQL.
* **Generación de Claves:** Para habilitar el sistema de validación QR (Offline First), se debe ejecutar el script `python security/generate_keys.py` dentro del entorno virtual. Este script inyecta la clave privada ES256 (`PRIVATE_KEY`) en el `.env` del backend e imprime la clave pública necesaria para el frontend.
* **Base de Datos y Seeding:** El contenedor se inicia mediante `docker-compose up -d`. Las tablas se generan aplicando las migraciones con `alembic upgrade head`. Los datos base y usuarios de prueba se insertan ejecutando `python seed.py` (el cual borra registros previos) o `python seed_usuario_prueba.py` de forma no destructiva.

### 1.2. Inicialización Local del Frontend

* **Instalación:** En una terminal separada, se debe navegar al directorio `pwa-acceso` y ejecutar `npm install`.
* **Configuración:** Crear un archivo `.env` inyectando la clave generada en el paso anterior bajo la variable `VITE_PUBLIC_KEY`.
* **Ejecución:** La versión optimizada se levanta ejecutando `npm run build` seguido de `npm run preview`.

## 2. Pipeline de Integración Continua (CI/CD)

El proyecto utiliza GitHub Actions (`.github/workflows/test.yml`) para automatizar la ejecución de pruebas antes de cualquier integración en las ramas `main` o `dev`.

* **Job del Backend:** Se ejecuta en una imagen `ubuntu-latest` instanciando un contenedor efímero de `postgres:15` en el puerto 5435 con credenciales de prueba. Configura el entorno Python 3.13.7, instala dependencias vía Pipenv, ejecuta el generador de claves efímeras y finalmente corre la suite de `pytest` exigiendo una cobertura mínima del 80% (`--cov-fail-under=80`).

* **Job del Frontend:** Se ejecuta en paralelo utilizando la versión Node.js 20.19.0. Instala dependencias con `npm ci` aprovechando la caché, valida la compilación TypeScript mediante `npm run build` y ejecuta la suite de pruebas locales con `vitest` y `fake-indexeddb`.


## 3. Entorno publicado

El sistema se publica en tres plataformas. Ninguna credencial se guarda en el repositorio: todas se cargan en el panel de cada plataforma.

| Parte | Plataforma | Plan |
|---|---|---|
| Backend (FastAPI) | Render, *Web Service* | Free |
| Base de datos (PostgreSQL) | Neon | Free |
| Frontend (web de reservas, panel y PWA) | Vercel | Hobby |

Se usa Neon y no la base gratuita de Render porque esta vence a los 30 días de creada, y el proyecto tiene que seguir funcionando hasta la presentación.

### 3.1. Base de datos (Neon)

* Un proyecto de Neon con una base de datos. La cadena de conexión (*Connection string*) se copia desde el botón **Connect** del proyecto y se usa como `DATABASE_URL` del backend.
* Se usa la conexión directa (sin `-pooler` en el host). La cadena incluye `sslmode=require`.
* La base gratuita se suspende después de 5 minutos sin consultas y se reactiva sola con la siguiente consulta.

### 3.2. Backend (Render)

* **Repositorio y rama:** `ISI-ProyectoFinal-2026/Grupo8`, rama `main`. Render vuelve a desplegar con cada cambio en `main`.
* **Root Directory:** `backend`.
* **Runtime:** Python 3.
* **Build Command:** `pip install pipenv && pipenv requirements > requirements.txt && pip install -r requirements.txt`. Instala exactamente las versiones de `Pipfile.lock`.
* **Start Command:** `alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port $PORT`. Las migraciones se aplican solas en cada despliegue; si una falla, el servicio no arranca y el error queda en los logs.
* **Health Check Path:** `/health`.
* **Variables de entorno** (*Environment*):

| Variable | Valor |
|---|---|
| `PYTHON_VERSION` | `3.13` (la que pide el `Pipfile`) |
| `PYTHONUNBUFFERED` | `1`, para que los `print` aparezcan en los logs al momento |
| `ENVIRONMENT` | `production` (deshabilita los endpoints de prueba) |
| `DATABASE_URL` | Cadena de conexión de Neon |
| `AUTH_SECRET_KEY` | Texto aleatorio largo, distinto del de desarrollo |
| `JWT_PRIVATE_KEY` / `VITE_PUBLIC_KEY` | Par de claves ES256 en una sola línea con `\n`, sin comillas |
| `MERCADOPAGO_ACCESS_TOKEN` / `MERCADOPAGO_PUBLIC_KEY` | Credenciales de prueba de la aplicación (`APP_USR-...`) |
| `MERCADOPAGO_WEBHOOK_SECRET` | Clave secreta de Tus integraciones > Webhooks |
| `RESEND_API_KEY` | Clave de Resend |
| `FRONTEND_URL` | Dirección de Vercel, por ejemplo `https://qamp.vercel.app` |
| `BACKEND_PUBLIC_URL` | Dirección de Render, por ejemplo `https://qamp-api.onrender.com` |

El resto de las variables de `.env.example` tienen valores por defecto en `core/config.py`.

* **Plan Free:** el servicio se suspende después de 15 minutos sin tráfico y tarda alrededor de un minuto en volver. Antes de una prueba o de la demo conviene abrir `/health` para despertarlo.

### 3.3. Frontend (Vercel)

* **Root Directory:** `frontend/pwa-acceso`. **Framework Preset:** Vite.
* **Variables de entorno:** `VITE_API_URL` (dirección de Render, sin `/` final) y `VITE_PUBLIC_KEY` (la misma clave pública que tiene el backend). Vite las incorpora al compilar, así que después de cambiarlas hay que volver a desplegar.
* `vercel.json` reescribe todas las rutas a `index.html`. Sin ese archivo, entrar directo a una ruta como `/pago/exito` (que es a donde vuelve Mercado Pago) da 404.

### 3.4. Datos iniciales

`seed.py` borra los usuarios y las reservas y carga los de prueba. Solo se ejecuta en el entorno de prueba, desde una PC del equipo, apuntando a la base publicada:

* `PIPENV_DONT_LOAD_ENV=1` evita que `pipenv run` pise `DATABASE_URL` con la del `.env` local.
* Antes de ejecutarlo se verifica a qué base apunta con `python -c "from core.database import engine; print(engine.url.host)"`.

En producción no se ejecuta el seed de pruebas.

## 4. Integraciones de terceros

### 4.1. Mercado Pago

* **Credenciales:** las de prueba de la aplicación (empiezan con `APP_USR-`). El pago se hace con la cuenta de prueba comprador y las tarjetas de prueba.
* **Webhook:** la preferencia envía `notification_url` a partir de `BACKEND_PUBLIC_URL`. Además, en Tus integraciones > Webhooks > Configurar notificaciones se carga `https://<backend>/api/payments/webhook` con el evento **Pagos**. De ahí sale la clave secreta (`MERCADOPAGO_WEBHOOK_SECRET`) y desde ahí se puede simular un aviso. La URL de la preferencia tiene prioridad sobre la del panel.
* **Desarrollo local:** Mercado Pago no envía avisos a `localhost`. Para recibirlos se expone el puerto 8000 con un túnel (`ngrok http 8000`) y se carga esa URL en `BACKEND_PUBLIC_URL`; sin túnel, el pago se confirma con "Verificar pago".
* **`auto_return`:** con el pago aprobado, Mercado Pago devuelve solo al cliente a `/pago/exito`. Solo se envía cuando `FRONTEND_URL` es una dirección publicada, porque Mercado Pago no acepta `auto_return` con direcciones locales.

### 4.2. Resend

* Mientras no haya un dominio verificado, el remitente es `onboarding@resend.dev` y Resend solo entrega correos al email del dueño de la cuenta (a cualquier otro responde 403). En las pruebas, el email del titular de la reserva tiene que ser ese.
* Para enviar a cualquier destinatario hace falta un dominio propio verificado en Resend (registros SPF y DKIM en el DNS del dominio).

## 5. Prueba del pago con el sandbox (sub-issue 21.1)

Fecha: ____ · Backend: ____ · Frontend: ____

### 5.1. Checklist

- [ ] `/health` del backend publicado responde `status: ok`.
- [ ] Los logs de Render muestran las migraciones aplicadas hasta el head.
- [ ] Ninguna credencial en el repositorio: `.env` no está versionado y `git grep -l "APP_USR\|BEGIN PRIVATE KEY" -- . ":!docs"` no devuelve nada.
- [ ] El frontend publicado carga y entrar directo a `/pago/exito` no da 404.
- [ ] Reserva creada desde el frontend publicado, con el email del dueño de la cuenta de Resend.
- [ ] Mercado Pago abre el checkout de prueba.
- [ ] Pago aprobado con la cuenta de prueba comprador y una tarjeta de prueba (titular `APRO`).
- [ ] `auto_return`: Mercado Pago vuelve solo a `/pago/exito`.
- [ ] Webhook recibido: los logs de Render muestran `AVISO DE MERCADO PAGO RECIBIDO` y la reserva actualizada a PAGADO, sin `401`.
- [ ] La reserva figura pagada en la base (`estado_pago = PAGADO`) y tiene su fila en `pagos`.
- [ ] Llegó el correo con el QR adjunto.
- [ ] Pago rechazado (titular `OTHE`): la reserva sigue pendiente y no se envía correo.

### 5.2. Problemas encontrados

| Problema | Solución |
|---|---|
| Sin `vercel.json`, volver de Mercado Pago a `/pago/exito` daba 404 en Vercel. | Se agregó `frontend/pwa-acceso/vercel.json` con la reescritura a `index.html`. |
| `alembic/env.py` armaba la conexión con `POSTGRES_*` y `127.0.0.1`, así que no podía migrar la base publicada. | Usa `DATABASE_URL` si está definida. |
| `auto_return` estaba desactivado porque Mercado Pago lo rechaza con direcciones locales. | Se envía solo cuando `FRONTEND_URL` es una dirección publicada. |
| `pipenv run` carga el `.env` local por encima de las variables de la terminal, y el seed podía terminar borrando la base local. | `PIPENV_DONT_LOAD_ENV=1` y verificación del host antes del seed. |
| La base gratuita de Render vence a los 30 días. | Base en Neon. |
| El backend gratuito se suspende tras 15 minutos sin tráfico; el primer aviso de Mercado Pago puede llegar con el servicio dormido. | Abrir `/health` antes de pagar. Mercado Pago reintenta los avisos y queda "Verificar pago". |
| _(completar con lo que aparezca en la prueba)_ | |
