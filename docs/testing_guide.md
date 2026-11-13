# Guía de Pruebas (Testing y QA) 

Esta guía documenta la estrategia integral de aseguramiento de calidad (QA) y las suites de pruebas automatizadas y manuales implementadas. El proyecto utiliza herramientas especializadas para probar la criptografía, la lógica de negocio asíncrona y el comportamiento *offline-first* de la Progressive Web App (PWA).

## 1. Pruebas de Backend (`pytest`)

El backend implementa una suite de pruebas automatizadas utilizando `pytest` junto con `AnyIO` y `httpx.AsyncClient` para soportar la ejecución asíncrona de los tests de integración.

### 1.1. Seguridad y Motor Criptográfico

* Los tests unitarios ubicados en `modules/security/test_security_service.py` validan que los tokens generados con firmas legítimas devuelvan una coincidencia exacta de datos tras ser decodificados.

* Se evalúa la expiración temporal de los JWT, asegurando que el sistema rechace tokens vencidos lanzando explícitamente una `ExpiredSignatureError`.

* Se comprueba la validación estricta de esquemas Pydantic, asegurando que los *payloads* mal formados sean rechazados antes de llegar al proceso de firma matemática.

### 1.2. Lógica de Negocio y Endpoints de Integración

* Se desarrollaron tests asíncronos para simular el comportamiento de producción, orquestando las rutas de la API, los servicios de capacidad y las transacciones en PostgreSQL.

* Para evitar colisiones de integridad referencial (Error 500 por violaciones de clave foránea) durante ejecuciones en GitHub Actions, se implementó una función auxiliar que inyecta datos efímeros. Esta función crea un usuario temporal con DNI y correo aleatorio (UUID) justo antes de iniciar la simulación HTTP POST de una reserva.

* Se agregaron pruebas exhaustivas para los endpoints asíncronos de contingencia: `GET /api/v1/sincronizacion/bootstrap` (evaluando la paginación correcta) y `POST /api/v1/ingresos/bulk-sync` (evaluando lotes múltiples, reservas inexistentes e ingresos duplicados).

* Se testeó la idempotencia del script `security/generate_keys.py`, confirmando que no sobrescriba un par de claves ES256 preexistente.

### 1.3. Base de Datos Local y Datos de Prueba

* El script `seed.py` permite inicializar un estado base coherente borrando los registros en orden relacional inverso (primero reservas, luego usuarios) y generando usuarios de prueba y 15 registros de reservas para facilitar pruebas de desarrollo inmediatas.

### 1.4. Validación de Datos y Formularios (Schemas)
* Restricciones de Negocio: El archivo test_validacion_reservas.py evalúa de forma unitaria y a nivel API los límites definidos en la configuración (MAX_PERSONAS_POR_RESERVA y MAX_NOCHES_POR_RESERVA), confirmando que la API rechace datos inválidos independientemente del frontend.

* Formatos y Saneamiento: Se verifica la correcta validación del EmailStr (mediante email-validator), la restricción de caracteres para el titular (solo letras, espacios, puntos, apóstrofes y guiones) y que la reserva ya no pida teléfono (se ignora si un cliente anterior lo envía), asegurando además que los espacios en blanco sean recortados.

* Fechas Relativas: Los tests de reservas (como test_reserva_normalizada.py) utilizan lógicas de fechas relativas a "hoy" (hora de Argentina) para evitar roturas temporales, asegurando que el ingreso no sea anterior a hoy y el egreso no sea anterior al ingreso.

* Ajustes de Capacidad: El test test_limite_de_capacidad se adaptó para inyectar y evaluar cantidades válidas (menores o iguales al máximo permitido) antes de forzar el fallo de aforo.

### 1.5. Tests sobre Totales de toda la Base (Ocupación y Cobros)

* La ocupación y el resumen de cobros suman todas las filas de `ingresos_fisicos`, `egresos_fisicos` y `pagos`, así que cualquier dato que haya quedado en la base cambiaría sus resultados.

* Por eso `test_ocupacion_api.py` y `test_cobros_api.py` usan el fixture `db_aislada`: abre una transacción, vacía esas tablas dentro de ella y reemplaza `get_db` para que los endpoints usen esa misma sesión. Con `join_transaction_mode="create_savepoint"`, los `commit()` de los endpoints no guardan nada y al final se deshace todo, por lo que la base local queda igual que antes.

* Los tests que crean filas sin esta transacción (por ejemplo, los de `bulk-sync` o egresos) deben borrar al terminar lo que crearon, incluidos los ingresos manuales, que no tienen reserva asociada.


## 2. Pruebas de Frontend (`vitest`)

La PWA emplea `vitest` para ejecutar pruebas unitarias y de integración que validan el comportamiento desconectado de la red, la criptografía en el navegador y el motor transaccional local.

### 2.1. Validación Criptográfica de QR

* Ubicada en `src/utils/security.test.ts`, la suite evalúa el motor `verifyQRToken` generando claves ES256 efímeras para cada test mediante `jose.generateKeyPair('ES256')`.

* Las aserciones verifican la detección de *tampering* (falsificación): utilizando funciones auxiliares para decodificar en Base64Url, se altera exclusivamente el contenido (ej. cambiando `cantidad_personas` de 2 a 5) manteniendo el encabezado y firma originales. El test comprueba que la librería rechaza el token al detectar inconsistencias matemáticas.

* Se confirma que un token con firma manipulada o con una fecha de expiración pasada (`exp` menor al reloj del sistema) retorna un acceso denegado (`null`).


### 2.2. Aislamiento y Listas Negras (IndexedDB)

* Se implementó la dependencia `fake-indexeddb` en el entorno de pruebas, ya que `jsdom` no implementa IndexedDB nativamente para soportar a Dexie.js.

* Ubicada en `src/services/accessValidationService.test.ts`, la suite comprueba la combinación del JWT con la verificación de revocación local, limpiando la tabla `db.blacklist` iterativamente mediante `afterEach` para evitar contaminación entre pruebas.

* Los tests asertan los estados `INVALID_TOKEN` (firma corrompida), `REVOKED` (identificador presente en la lista negra) y `VALID`.


### 2.3. Cola de Sincronización y Simulación Offline

* Ubicada en `src/services/dbService.test.ts`, la suite comprueba que la inserción de datos maneje un estricto orden cronológico (FIFO).

* El control de los tiempos simulados se realiza mediante `vi.useFakeTimers({ toFake: ['Date'] })`, limitándose a la clase `Date` para no colgar el *event loop* interno de `fake-indexeddb`.

* Ubicada en `src/services/syncService.test.ts`, se evalúa la tolerancia a fallos de red simulando un error `TypeError('Failed to fetch')` al registrar un ingreso. Se verifica que la excepción sea interceptada limpiamente y que el ingreso conserve el indicador `sincronizado: false`.

* El proceso de reintento mitiga un defecto de bloqueo conocido (donde `isSyncing` quedaba en verdadero permanentemente) reseteando `syncService.isSyncing = false` manualmente en el bloque `beforeEach` del test.


## 3. Pruebas End-to-End (E2E) y Dispositivos Reales

### 3.1. Pruebas de Estrés y Contingencia

* Se ejecutaron simulaciones de estrés E2E provocando una pérdida de conexión intencional a través del panel de control *Network* en las herramientas de desarrollo de Chrome (DevTools).

* Al reconectar la red, se verificó el disparo automático del vaciado de la cola local sin generar duplicaciones en PostgreSQL.


### 3.2. Túneles Locales para Cámara Móvil

* Dado que navegadores como Chrome y Safari en iOS/Android bloquean el acceso al hardware de la cámara si la página no se sirve mediante el protocolo HTTPS, se estableció un flujo de pruebas utilizando la herramienta `ngrok`.

* El proceso requiere levantar la aplicación localmente en el puerto 4173 (`npm run preview`) y abrir un túnel HTTP hacia dicho puerto mediante el comando `ngrok http 4173`. La URL pública resultante (`[https://...ngrok-free.app](https://...ngrok-free.app)`) se utiliza en el dispositivo móvil real para probar el módulo de escaneo.


### 3.3. Recorrido feliz automatizado con Playwright (Issue 24.1)

La prueba `frontend/pwa-acceso/e2e/happy-path.spec.ts` recorre el sistema completo con tres navegadores separados (cliente, guardia y administrador): reserva, pago con Mercado Pago, QR por correo, escaneo en la puerta, ocupación del panel y egreso.

#### Preparación (una sola vez por máquina)

1. PostgreSQL encendido y `backend/.env` completo (con las claves de `security/generate_keys.py`), igual que para desarrollo.
2. `VITE_PUBLIC_KEY` en `frontend/pwa-acceso/.env`, igual que para desarrollo.
3. Dependencias del backend: `pipenv install --dev` (carpeta `backend`).
4. Desde `frontend/pwa-acceso`:

```bash
npm install
npm run e2e:instalar   # descarga Chromium para Playwright
```

#### Ejecución (un solo comando)

Desde `frontend/pwa-acceso`:

```bash
npm run test:e2e
```

Ese comando:

1. Prepara la base de pruebas `<POSTGRES_DB>_e2e` (la crea si no existe, la vacía y aplica todas las migraciones) y crea un administrador y un guardia con contraseñas generadas al azar en cada corrida. El script (`backend/e2e_preparar_db.py`) se niega a trabajar sobre una base que no termine en `_e2e`, así que nunca toca la base de desarrollo.
2. Levanta el backend en el puerto **8001**.
3. Compila la PWA (`npm run build`) y la sirve con `vite preview` en el puerto **4173**. Se prueba el build porque el service worker solo existe ahí (lo necesitan las pruebas sin conexión).
4. Levanta un Mercado Pago y un Resend falsos en el puerto **8090**: no se hacen pagos reales ni se envían correos.
5. Corre las pruebas y apaga todo al terminar.

Los puertos son distintos a los de desarrollo (8000 y 5173), así que se puede correr con el entorno de desarrollo encendido.

Otros comandos útiles:

| Comando | Para qué sirve |
|---|---|
| `npm run test:e2e:ui` | Modo visual: paso a paso, con la pantalla de cada acción |
| `npm run test:e2e:informe` | Abre el informe HTML de la última corrida |
| `npx playwright show-trace test-results/<carpeta>/trace.zip` | Reproduce una prueba fallida (se guarda la traza, captura y video solo cuando falla) |
| `npm run typecheck:e2e` | Revisa los tipos de los archivos de `e2e/` |

#### Decisiones de diseño

* **Selectores accesibles.** Las pruebas buscan los elementos como los ve una persona o un lector de pantalla: `getByRole`, `getByLabel` y `getByText`, nunca clases CSS ni XPath. Esto obligó a asociar etiquetas que faltaban (nombre y edad de cada visitante, email de contacto y el campo del token en el escáner). La ocupación se lee del `aria-valuenow` de la barra de progreso del monitor.
* **Mercado Pago simulado.** El backend no confía en el aviso: con el id del pago consulta a Mercado Pago. Por eso no alcanza con mandar un aviso falso: el SDK apunta a un Mercado Pago falso con `MERCADOPAGO_API_URL` (solo se respeta fuera de producción). El cliente pasa por una pantalla de pago simulada, vuelve a `/pago/exito` con el `payment_id` en la URL y la prueba manda el aviso firmado con HMAC (la misma firma `x-signature` que valida el backend) al endpoint `/api/payments/webhook`.
* **QR.** Resend también apunta al servidor falso (`RESEND_API_URL`). La prueba toma el PNG adjunto del correo, lo decodifica con `jsqr` (lo mismo que haría la cámara) y lo ingresa en el campo manual del escáner, que pasa por la misma validación que el QR leído con la cámara.
* **Sincronización.** La PWA envía los ingresos al detectar que vuelve la conexión o cada 5 minutos. La prueba adelanta el reloj del navegador del guardia 5 minutos (`page.clock`) en vez de esperar.
* **Sin secretos en el repositorio.** Las contraseñas del administrador y del guardia y la clave del webhook se generan al azar en cada corrida (`e2e/entorno.ts`).
* **De a una prueba por vez** (`workers: 1`): todas comparten la base y el contador de ocupación. Las aserciones comparan contra la ocupación inicial y no contra 0.

#### Errores habituales

* `No existe .../backend/.env`: copiar `backend/.env.example` a `backend/.env` y completarlo.
* `Process from config.webServer was not able to start`: revisar el texto anterior al error. Suele ser PostgreSQL apagado, `pipenv` sin instalar o un puerto (8001, 4173 u 8090) ocupado.
* `Executable doesn't exist`: falta el navegador; correr `npm run e2e:instalar`.
* La prueba falla al validar el QR: `VITE_PUBLIC_KEY` del frontend no corresponde a `JWT_PRIVATE_KEY` del backend.

## 4. Entorno de Integración Continua (CI/CD)

El sistema valida ambas bases de código antes de cualquier integración en la rama principal (`main` o `dev`) utilizando GitHub Actions (`.github/workflows/test.yml`).

### 4.1. Configuración de la Pipeline

* El flujo consta de dos *jobs* paralelos (`backend-tests` y `frontend-tests`), eliminando la necesidad de archivos separados.

* **Job Backend:** Levanta un servicio auxiliar de PostgreSQL 15 con credenciales de prueba e inicializa un chequeo de salud continuo (`pg_isready`). Instala Pipenv y ejecuta el script de generación de claves ES256 antes de correr `pytest`.

* **Job Frontend:** Emplea Node.js 20.19.0, instala dependencias estructuradas (`npm ci`), compila la validación estricta de TypeScript (`npm run build`) y ejecuta toda la suite de `vitest` en memoria usando `fake-indexeddb` sin requerir base de datos externa.


### 4.2. Umbrales de Cobertura y Bugs Detectados

* El pipeline backend exige explícitamente una cobertura mínima de código del 80% configurada mediante `pytest-cov` en los archivos `Pipfile` y `pyproject.toml`.

* Existen exclusiones justificadas de cobertura para archivos de migración Alembic, scripts de *seeding* (como `seed.py` o `seed_qr.py`) y los propios archivos de test.

* Durante el desarrollo de la cobertura de la sincronización masiva se expusieron y repararon bugs genuinos de producción. Destaca la detección de la falta de orden FIFO real en la consulta IndexedDB original (corregido aplicando un `.sort()` explícito de `fecha_escaneo`) y un error de tipo crítico en el modelo de auditoría `conflictos.py` (corregido cambiando la tipificación a `UUID` e integrando el modelo con la base declarativa de SQLAlchemy). Tras añadir los tests y soluciones, la cobertura final de la arquitectura API backend alcanzó el 91.11%.