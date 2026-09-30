# Grupo8
Control de accesos en clubes

## Requisitos Previos
Para poder ejecutar este proyecto, necesitas tener instalado en tu computadora:
* [Python 3.x](https://www.python.org/)
* [Pipenv](https://pipenv.pypa.io/en/latest/) (Gestor de entornos virtuales)
* [Node.js y npm](https://nodejs.org/) (Para el entorno de desarrollo Frontend / PWA)
* [Docker Desktop](https://www.docker.com/products/docker-desktop)

---

## ⚙️ Entorno Backend y Base de Datos

### 1. Preparar el entorno
```bash
git clone <url-del-repositorio>
cd Grupo8
pipenv install --dev
```

### 2. Variables de Entorno y Seguridad QR
Crea un archivo `.env` en la raíz del proyecto tomando como referencia `.env.example`. *Nota: Es importante mantener el puerto 5435 para evitar conflictos con otras bases de datos locales.*

**Configuraciones externas requeridas:**
*   **Base de Datos:** Es importante mantener el puerto 5435 para evitar conflictos con otras bases de datos locales.
*   **Mercado Pago:** Solicita al administrador del proyecto el `MP_ACCESS_TOKEN` y la `MP_PUBLIC_KEY` de prueba para procesar pagos localmente, y pégalos en tu `.env`.

**Generación de Claves QR:**
Para que el sistema de validación de QRs funcione (Offline First), genera el par de claves (ES256). Dentro del entorno virtual (`pipenv shell`), ejecuta:
```bash
python security/generate_keys.py
```
*Nota: Este script inyectará la PRIVATE_KEY en tu .env del backend y te imprimirá por consola la PUBLIC_KEY necesaria para el frontend.*

### 3. Base de Datos, Migraciones y Seeding
Levanta la base de datos con Docker (asegurate de tener Docker Desktop abierto):
```bash
docker-compose up -d
```
*(Para apagar y borrar los datos locales: `docker-compose down -v`)*

Crea las tablas en tu base de datos local usando Alembic:
```bash
alembic upgrade head
```
*(Para generar nuevas migraciones tras modificar modelos: `alembic revision --autogenerate -m "Descripción"`)*

Limpia y carga los datos de prueba iniciales:
```bash
python seed.py
```

---

## 📱 Entorno Frontend (PWA)

### 1. Instalación
Abre una nueva terminal para mantener el ecosistema separado, navega a la carpeta y descarga las dependencias:
```bash
cd pwa-acceso
npm install
```

### 2. Configuración
Crea un archivo `.env` dentro de la carpeta del frontend y pega la clave pública generada en el backend:
`VITE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"`

### 3. Probar la PWA localmente
Compila y levanta la versión de producción:
```bash
npm run build
npm run preview
```

**Tips para probar la PWA (Caché e Instalación):**
* **Caché:** Los "Service Workers" guardan la app en memoria. Si no ves tus cambios (ej. íconos o colores), recarga forzando la limpieza con `Ctrl + F5`. Si persiste, abre el Inspector (F12) > Application > Service workers > `Unregister`.
* **Instalación:** Al levantar el proyecto en `http://localhost:4173/`, puedes instalar la app desde el ícono de monitor en la barra de direcciones, o desde el menú de opciones del navegador seleccionando "Instalar Sistema de Acceso".

---

## 🧪 Testing Automatizado

**Test del backend (pytest):**
Verifica los servicios de encriptación, validación de schemas y emisión de JWT. Desde la carpeta `backend`:
```bash
pipenv run pytest -v
```
*> 💡 **Solución de errores:** Si aparece un error como `ModuleNotFoundError`, ejecuta `pipenv run python -m pytest -v` para que Python reconozca las rutas relativas.*

**Test del frontend (vitest):**
Verifica el comportamiento de la Web Crypto API y los bloqueos de la barrera. Desde `frontend/pwa-acceso`:
```bash
npm run test
```

---

## 💳 Módulo de Pasarela de Pagos (Mercado Pago)

El sistema integra cobros en línea mediante el SDK oficial de Mercado Pago y FastAPI, persistiendo los estados en PostgreSQL.

**Flujo de Integración:**
1. **Creación de Preferencia (`POST /api/payments/create`):** Genera la orden vinculando el UUID de la reserva local en `external_reference`.
2. **Notificación Asíncrona (`POST /api/payments/webhook`):** Recibe eventos, consulta el estado real (`payment().get()`) y actualiza la reserva a `PAGADO` de manera atómica.
3. **Mecanismo de Reconciliación y Contingencia (`GET /api/payments/reconcile/{reserva_id}`):** Flujo de verificación manual para mitigar posibles fallas en el webhook (cortes de red, caídas del servidor). Utiliza el SDK para consultar a la API filtrando por `external_reference`. Si hay un cobro `approved`, actualiza la reserva en PostgreSQL. Se dispara manualmente desde el panel de gestión ("Verificar Pago").
4. **Pantallas de Retorno:** Vistas dedicadas (`/pago/exito` y `/pago/rechazado`) para la respuesta visual al usuario.

**⚠️ Consideraciones de Entorno Local:**
- **Túnel ngrok para Webhooks:** En desarrollo, se requiere exponer el puerto `8000` con `ngrok http 8000` y definir la URL en `notification_url` (MP no notifica a localhost).
- **Restricción de retorno:** Mercado Pago bloquea por seguridad el retorno automático (`auto_return`) hacia `http://localhost`. En producción (con HTTPS), este bloqueo se levanta automáticamente.

---

## 📚 Documentación de la API
Con el backend en ejecución, prueba los endpoints y requerimientos accediendo a Swagger UI:
- **Local:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)