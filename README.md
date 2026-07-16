# Grupo8
Control de accesos en clubes

## Requisitos Previos
Para poder ejecutar este proyecto, necesitas tener instalado en tu computadora:
* [Python 3.x](https://www.python.org/)
* [Pipenv](https://pipenv.pypa.io/en/latest/) (Gestor de entornos virtuales)
* [Docker Desktop](https://www.docker.com/products/docker-desktop)

## Instalación y Configuración Local

**1. Clonar el repositorio y preparar el entorno**
`git clone <url-del-repositorio>`
`cd Grupo8`

**2. Configurar las Variables de Entorno**
Crear un archivo `.env` en la raíz del proyecto tomando como referencia el archivo `.env.example`.
*Nota: Es importante mantener el puerto 5435 para evitar conflictos con otras bases de datos PostgreSQL locales.*

**3. Instalar las dependencias**
`pipenv install`

**4. Levantar la Base de Datos con Docker**
`docker-compose up -d`
*(Para apagar y borrar los datos locales, utilizar: `docker-compose down -v`)*

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