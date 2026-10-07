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


## 3. Despliegue a Producción: Backend (Render)

El servidor de la API REST está configurado para desplegarse automáticamente en la plataforma PaaS Render.

* **Configuración del Servicio:** El servicio apunta estrictamente al directorio raíz `backend`.

* **Control de Entorno:** El entorno de ejecución se fuerza a la versión Python 3.13.7 mediante variables de entorno nativas de Render, asegurando compatibilidad estricta con el `Pipfile.lock`.

* **Punto de Entrada:** El comando de arranque configurado en el servicio es `pipenv run uvicorn main:app --host 0.0.0.0 --port 10000`. El archivo `main.py` inicializa el motor FastAPI y expone el endpoint de estado `/health`.

* **Gestión de Secretos:** El archivo `.env` se excluye del control de versiones (`.gitignore`). Las credenciales críticas, como `POSTGRES_*` para la base de datos de producción y `JWT_PRIVATE_KEY` para la firma de tokens QR, se inyectan como variables encriptadas en el hardware virtual de Render.


## 4. Despliegue a Producción: Frontend (Vercel)

La Progressive Web App (PWA) de react/Vite está orquestada para su alojamiento y entrega global mediante Vercel.

* **Configuración de Directorio:** El *Root Directory* del proyecto en Vercel está configurado apuntando a `frontend/pwa-acceso` para aislar el entorno de compilación de Vite respecto al monorepo completo.

* **Compilación:** El proceso de *build* es automatizado por Node.js y Vite, tomando como punto de entrada de trazabilidad el archivo `src/main.tsx`.

* **Inyección Criptográfica:** La clave pública asimétrica (`VITE_PUBLIC_KEY`) encargada de la validación matemática de los tokens *offline* se provisiona de forma segura a través del panel de *Environment Variables* de Vercel.

* **Automatización:** Vercel utiliza webhooks integrados con GitHub para disparar redespliegues automáticos ante cada *commit* exitoso en la rama principal (`main`).


## 5. Integraciones de Terceros en Despliegue

La plataforma depende de dos proveedores en la nube externos que requieren configuración específica según el entorno.

* **Mercado Pago (Pasarela de Pagos):**
* Requiere la configuración de `MP_ACCESS_TOKEN` (y opcionalmente `MP_PUBLIC_KEY` para el SDK de frontend en testing) en el archivo `.env` o en el panel de Render.

* **Simulación Local de Webhooks:** Mercado Pago no envía notificaciones a `localhost`. Durante el desarrollo local, es obligatorio exponer el puerto del backend (8000) utilizando un túnel (ej. `ngrok http 8000`) e inyectar la URL pública generada en el parámetro `notification_url` de la preferencia de pago.

* **Restricción de Redireccionamiento:** La opción `auto_return` es bloqueada por seguridad hacia orígenes locales (`http://localhost`). En el entorno de producción (Render + Vercel), la presencia de certificados HTTPS nativos levanta este bloqueo automáticamente.

* **Resend (Módulo de Correos):**
* Requiere la configuración de `RESEND_API_KEY` generada desde el panel oficial.

* En modo de desarrollo, Resend fuerza el uso de un remitente de prueba (`onboarding@resend.dev`) y bloquea correos hacia destinatarios distintos al dueño de la cuenta registrada (Error 403).

* En producción, se requiere añadir un dominio propio en el panel de Resend (ej. `qamp.com.ar`) y configurar los registros DNS (SPF y DKIM) pertinentes en el proveedor de dominios para asegurar la entregabilidad de los códigos QR.