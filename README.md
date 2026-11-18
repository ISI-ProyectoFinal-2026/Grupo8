# Qamp

Sistema de gestión para campings y clubes recreativos: reservas, pagos con Mercado Pago, control de acceso con QR (PWA offline-first) y control de capacidad.

| Parte | Tecnología | Carpeta |
|---|---|---|
| Backend (API) | Python + FastAPI, SQLAlchemy + Alembic | `backend/` |
| Base de datos | PostgreSQL 16 (Docker) | `backend/docker-compose.yml` |
| Web de reservas, panel y PWA de acceso | React + TypeScript + Vite | `frontend/pwa-acceso/` |

---

## Requisitos previos

* [Python 3.13](https://www.python.org/) (es la versión que pide el `Pipfile`)
* [Pipenv](https://pipenv.pypa.io/en/latest/)
* [Node.js](https://nodejs.org/) 20.19 o superior (o 22.12 o superior), con npm
* [Docker Desktop](https://www.docker.com/products/docker-desktop)
* Git

```bash
git clone https://github.com/ISI-ProyectoFinal-2026/Grupo8.git
cd Grupo8
```

> Se trabaja con **dos terminales**: una en `backend/` y otra en `frontend/pwa-acceso/`. Todos los comandos de abajo indican desde qué carpeta se ejecutan.

---

## ⚙️ Backend y base de datos

Todo lo de esta sección se ejecuta desde la carpeta `backend`:

```bash
cd backend
```

### 1. Instalar dependencias

```bash
pipenv install --dev
```

> El `Pipfile` está en `backend/`. Si se corre en la raíz del repositorio, Pipenv crea un entorno nuevo y vacío.

### 2. Crear el `.env`

El `.env` va dentro de `backend/` (de ahí lo leen Docker, la API, Alembic y las pruebas):

```bash
# Linux / macOS
cp .env.example .env
# Windows (PowerShell)
Copy-Item .env.example .env
```

#### Puerto de la base de datos

El `.env.example` usa el puerto **5432**, el de Postgres por defecto:

```env
POSTGRES_PORT=5432
DATABASE_URL="postgresql://postgres:root@localhost:5432/sgic_db"
```

> ⚠️ **Si ya tenés PostgreSQL instalado en tu computadora**, el 5432 va a estar ocupado. En ese caso es importante cambiar al puerto **5435** para evitar conflictos con otras bases de datos locales. Hay que cambiarlo en **los dos lugares**:
>
> ```env
> POSTGRES_PORT=5435
> DATABASE_URL="postgresql://postgres:root@localhost:5435/sgic_db"
> ```

El usuario, la contraseña y el nombre de la base de `DATABASE_URL` tienen que coincidir con `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB`.

#### Variables que hay que completar

El resto de las variables del `.env.example` ya sirve para desarrollo. Estas son las que hay que revisar:

| Variable | Qué es | De dónde sale |
|---|---|---|
| `JWT_PRIVATE_KEY` / `VITE_PUBLIC_KEY` | Par de claves ES256 que firma y valida los QR | Paso 3 |
| `MERCADOPAGO_ACCESS_TOKEN` / `MERCADOPAGO_PUBLIC_KEY` | Credenciales de prueba de Mercado Pago | Pedírselas al administrador del proyecto |
| `MERCADOPAGO_WEBHOOK_SECRET` | Clave para validar la firma de los avisos de pago | Panel de Mercado Pago (Webhooks). En local se puede dejar como está |
| `RESEND_API_KEY` | Envío de correos | Ver la sección "Correos con Resend" |
| `AUTH_SECRET_KEY` / `ARREPENTIMIENTO_SECRET_KEY` | Firmas del login y de los enlaces de arrepentimiento | En local sirven las del ejemplo. En producción generar unas propias con `python -c "import secrets; print(secrets.token_hex(32))"` |

> Si falta alguna variable obligatoria, la API no arranca y muestra cuál es.

### 3. Generar las claves de los QR (paso manual)

La PWA valida los QR sin conexión con una clave pública. Para eso se genera un par de claves ES256:

```bash
pipenv run python security/generate_keys.py
```

> ⚠️ **Ojo con dónde quedan las claves.** El script no escribe en `backend/.env`: crea (o completa) un `.env` en la **raíz del repositorio** con dos líneas, `JWT_PRIVATE_KEY="..."` y `VITE_PUBLIC_KEY="..."`. Tampoco las muestra por consola.

Después de correrlo:

1. Abrir el `.env` de la raíz del repositorio (`Grupo8/.env`).
2. Copiar las dos líneas y reemplazar con ellas las de ejemplo en `backend/.env`.
3. Copiar la línea `VITE_PUBLIC_KEY="..."` también en `frontend/pwa-acceso/.env` (ver la sección "Frontend").
4. Borrar el `.env` de la raíz, que ya no hace falta.

Errores posibles:

* **"Las claves criptográficas ya existen en el archivo .env"**: el `.env` de la raíz ya tiene claves y el script no las pisa. Usar esas o borrar ese archivo y volver a correrlo.
* **Los QR dejan de validar**: si se generan claves nuevas, todos los QR emitidos antes quedan inválidos. Las claves de `backend/.env` y del frontend tienen que ser del mismo par.

### 4. Levantar la base de datos

Con Docker Desktop abierto:

```bash
docker compose up -d
```

Crea el contenedor `postgres_camping` con los datos del `.env`. Se puede comprobar con `docker ps`.

* Si aparece **"port is already allocated"**, el puerto está ocupado: cambiar al 5435 como se explica en el paso 2.
* Para apagarla: `docker compose down`. Para apagarla **y borrar todos los datos**: `docker compose down -v`.

> En versiones viejas de Docker el comando es `docker-compose` (con guion).

### 5. Crear las tablas

```bash
pipenv run alembic upgrade head
```

Tiene que terminar sin errores, con una línea `Running upgrade ...` por cada migración.

* Para generar una migración nueva después de modificar los modelos: `pipenv run alembic revision --autogenerate -m "Descripción"`.
* Si falla con **"connection refused"**, la base no está levantada o el puerto de `DATABASE_URL` no coincide con `POSTGRES_PORT`.

### 6. Cargar datos de prueba

```bash
pipenv run python seed.py
```

> ⚠️ `seed.py` **borra** todos los usuarios y reservas antes de cargar los datos.

Usuarios que crea:

| Rol | Email | Contraseña | Dónde entra |
|---|---|---|---|
| Administrador | `admin@camping.com` | `admin123` | Panel: `/admin` |
| Guardia | `guardia@camping.com` | `admin123` | PWA de acceso: `/acceso/login` |
| Socios | `user0@test.com`, `user1@test.com` | `pass1234` | Web de reservas: `/login` |

Los demás `userN@test.com` son visitantes: tienen reservas a su nombre pero no inician sesión.

Otros scripts (todos desde `backend/`):

| Script | Qué hace |
|---|---|
| `seed_qr.py` | Igual que `seed.py`, pero además guarda las imágenes de los QR en `backend/qrs_generados/`. También **borra** los datos. |
| `seed_usuario_prueba.py` | Crea un usuario de prueba sin tocar nada más. Se puede correr las veces que haga falta. |
| `reset_db.py` | **Borra toda la base** y la recrea desde los modelos, sin migraciones. Después conviene volver a `alembic upgrade head` en una base limpia. |

**Usuario de prueba para desarrollo (no destructivo):**
Para reservar no hace falta ningún `user_id`: si la persona tiene la sesión iniciada, la reserva queda a su nombre (el backend lo saca del token); si no, se crea igual, sin cuenta. `GET /usuarios/prueba` quedó solo para desarrollo: devuelve un usuario existente en la base local (lo crea si no existe) y sirve, por ejemplo, para probar `GET /reservas/mias` con un token armado a mano. Queda deshabilitado si `ENVIRONMENT=production`.

### 7. Levantar la API

```bash
pipenv run uvicorn main:app --reload
```

* Swagger (documentación y prueba de endpoints): [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
* Estado de la API: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

> Para trabajar dentro del entorno sin escribir `pipenv run` cada vez: `pipenv shell`.

---

## 📱 Frontend (web de reservas, panel y PWA)

En otra terminal, desde la raíz del repositorio:

```bash
cd frontend/pwa-acceso
```

### 1. Instalar dependencias

```bash
npm install
```

### 2. Crear el `.env`

```bash
# Linux / macOS
cp .env.example .env
# Windows (PowerShell)
Copy-Item .env.example .env
```

Completar:

* `VITE_PUBLIC_KEY`: la misma línea del paso 3 del backend, en una sola línea y con los `\n`:
  `VITE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"`
* `VITE_API_URL`: dirección de la API (`http://127.0.0.1:8000` en local).
* `VITE_MAX_NOCHES`: tiene que coincidir con `MAX_NOCHES_POR_RESERVA` del backend. El máximo de personas ya no sale de `VITE_MAX_PERSONAS`: lo define cada tipo de reserva en el panel.
* `VITE_CAMPING_*`: nombre, contacto, horarios y redes que muestra la web de reservas. Los que quedan vacíos no se muestran.

> Vite lee estas variables al arrancar: después de cambiarlas hay que reiniciar `npm run dev`.

### 3. Levantar en modo desarrollo

```bash
npm run dev
```

Queda en [http://localhost:5173](http://localhost:5173):

| Ruta | Qué es |
|---|---|
| `/` | Web de reservas |
| `/admin` | Panel de administración |
| `/acceso/login` | PWA de acceso del guardia |

### 4. Probar la PWA instalable

El service worker solo existe en la versión compilada:

```bash
npm run build
npm run preview
```

Queda en [http://localhost:4173](http://localhost:4173).

**Tips (caché e instalación):**
* **Caché:** el service worker guarda la app. Si no se ven los cambios (íconos, colores), recargar con `Ctrl + F5`. Si sigue igual: Inspector (F12) > Application > Service workers > `Unregister`.
* **Instalación:** desde el ícono de instalar en la barra de direcciones o desde el menú del navegador, "Instalar Sistema de Acceso".

---

## ✉️ Correos con Resend

Qamp usa Resend para mandar el correo de confirmación de reserva con el QR de acceso.

> **Importante:** sin una API key real de Resend, el correo **no se envía**.

1. Crear una cuenta en [resend.com](https://resend.com).
2. Generar una API key.
3. Pegarla en `RESEND_API_KEY` de `backend/.env`.

**Remitente en modo prueba (`onboarding@resend.dev`):**
* Resend lo presta sin configuración.
* **Solo envía al correo con el que se creó la cuenta de Resend.** Con otro destinatario, Resend rechaza el envío con un error 403.
* Para probar, la reserva tiene que tener como email el mismo con el que te registraste en Resend.

Para producción hay que agregar un dominio propio en Resend y cargar los registros DNS que indica.

---

## 💳 Pagos con Mercado Pago

El sistema cobra con el SDK oficial de Mercado Pago y guarda los estados en PostgreSQL.

**Flujo:**
1. **Crear preferencia (`POST /api/payments/create`):** genera la orden con el UUID de la reserva en `external_reference`.
2. **Aviso de pago (`POST /api/payments/webhook`):** recibe el aviso, valida la firma con `MERCADOPAGO_WEBHOOK_SECRET`, consulta el estado real del pago y marca la reserva como `PAGADO`.
3. **Reconciliación (`GET /api/payments/reconcile/{reserva_id}`):** verificación manual por si el aviso no llegó (cortes de red, caída del servidor). Busca el pago por `external_reference` y, si está `approved`, actualiza la reserva. Se dispara desde el botón "Verificar pago".
4. **Pantallas de retorno:** `/pago/exito`, `/pago/rechazado` y `/pago/pendiente`.

**En local:**
* Mercado Pago no envía avisos a `localhost`. Sin túnel, el pago se confirma con "Verificar pago".
* Para recibir avisos en desarrollo: exponer el puerto `8000` con `ngrok http 8000` y poner la URL pública en `BACKEND_PUBLIC_URL` de `backend/.env`.
* Mercado Pago bloquea el retorno automático (`auto_return`) hacia `http://localhost`. Con HTTPS (producción) funciona.

---

## 🧪 Pruebas

### Backend (pytest)

Desde `backend/`, **con la base de datos levantada** (las pruebas usan la base local):

```bash
pipenv run pytest -v
```

* Si aparece `ModuleNotFoundError`, usar `pipenv run python -m pytest -v`.
* Si falla con "connection refused", falta `docker compose up -d`.

### Frontend (Vitest)

Desde `frontend/pwa-acceso/`:

```bash
npm run test
```

Para revisar el código: `npm run lint` y, para accesibilidad, `npm run lint:a11y`.

### End-to-end (Playwright)

Desde `frontend/pwa-acceso/`. Necesitan `backend/.env` creado y la base de datos levantada.

La primera vez, instalar el navegador:

```bash
npm run e2e:instalar
```

Correr las pruebas:

```bash
npm run test:e2e
```

* Playwright levanta solo el backend (puerto 8001) y el frontend compilado (puerto 4173). No hace falta tenerlos encendidos, pero esos puertos tienen que estar libres.
* Usa una base aparte, `<POSTGRES_DB>_e2e` (por ejemplo `sgic_db_e2e`), que crea y vacía en cada corrida. La base de desarrollo no se toca.
* Mercado Pago y Resend se reemplazan por servicios falsos: no hacen falta credenciales reales.
* Para verlas paso a paso: `npm run test:e2e:ui`. Informe de la última corrida: `npm run test:e2e:informe`.

---

## 📚 Más documentación

* API en vivo: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
* Carpeta [`docs/`](docs/): despliegue ([`deployment.md`](docs/deployment.md)), pruebas ([`testing_guide.md`](docs/testing_guide.md)), migraciones ([`guia_migraciones.md`](docs/guia_migraciones.md)), zonas horarias, accesibilidad y guía de usuario.
