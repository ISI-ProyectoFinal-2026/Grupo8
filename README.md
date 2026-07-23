# Grupo8
Control de accesos en clubes

## Requisitos Previos
Para poder ejecutar este proyecto, necesitas tener instalado en tu computadora:
* [Python 3.x](https://www.python.org/)
* [Pipenv](https://pipenv.pypa.io/en/latest/) (Gestor de entornos virtuales)
* [Node.js y npm](https://nodejs.org/) (Para el entorno de desarrollo Frontend / PWA)
* [Docker Desktop](https://www.docker.com/products/docker-desktop)

## Instalación y Configuración Local

**1. Clonar el repositorio y preparar el entorno**
`git clone <url-del-repositorio>`
`cd Grupo8`

**2. Configurar las Variables de Entorno**
Crear un archivo `.env` en la raíz del proyecto tomando como referencia el archivo `.env.example`.
*Nota: Es importante mantener el puerto 5435 para evitar conflictos con otras bases de datos PostgreSQL locales.*

**3. Instalar las dependencias**
`pipenv install --dev`

**4. Levantar la Base de Datos con Docker**
`docker-compose up -d`
*(Para apagar y borrar los datos locales, utilizar: `docker-compose down -v`)*

**5. Generacion de claves criptográficas (Seguridad QR - Offline First)**
- Para que el sistema de emisión y validación de QRs funcione, debes generar el par de claves matemáticas (ES256) iniciales. Dentro del entorno virtual (pipenv shell), ejecuta:
`python modules/security/generate_keys.py`
*Nota: Este script es seguro e idempotente. Inyectará la PRIVATE_KEY en tu .env del backend y te imprimirá por consola la PUBLIC_KEY necesaria para el frontend.

## Instalación y Configuración Local (Frontend)

**1. Navegar a la carpeta del frontend**
Abre una nueva terminal para mantener el ecosistema separado del backend y navega a la carpeta de la PWA:
`cd pwa-acceso`

**2. Instalar dependencias de Node**
`npm install`

**3. Configurar avariables de entorno del Frontend**
Crea un archivo .env dentro de la carpeta del frontend y pega la clave pública que se generó en el paso 5.
`VITE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"`

## Base de Datos y Migraciones (Alembic)

Este proyecto utiliza Alembic para el control de versiones de la base de datos. 

**Para crear las tablas en tu base de datos local (Lo que debe hacer todo el equipo):**
Asegurate de estar dentro del entorno virtual (`pipenv shell`) y tener Docker corriendo, luego ejecuta:
`alembic upgrade head`

**Para generar una nueva migración (Solo cuando se modifican los modelos en core/models):**
`alembic revision --autogenerate -m "Descripción de los cambios"`

## Seeding de Datos
Para limpiar la base de datos y cargar los datos de prueba iniciales:
1. Asegurate de que **Docker esté corriendo** y el contenedor de la base de datos esté activo.
2. Ejecutá en la terminal:
   `python seed.py`

## Testing atuomatizado
Este proyecto cuenta con una arquitectura de pruebas robusta para garantizar la seguridad del sistema de accesos.

**Test del backend (pytest)**:
Verifica los servicios de encriptación, validación de schemas y emisión de JWT. Desde la raíz del proyecto (Grupo8):
`pipenv run pytest -v`

**test del frontend (vitest)**:
Verifica el comportamiento de la Web Crypto API (librería jose) para la desencriptación offline y los bloqueos de la barrera. Desde la carpeta del frontend:
`npm run test`

## Documentación de la API

Una vez que el servidor backend esté en ejecución, puedes probar todos los endpoints y ver sus requerimientos accediendo a la documentación interactiva (Swagger UI) desde tu navegador:
- **Local:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)