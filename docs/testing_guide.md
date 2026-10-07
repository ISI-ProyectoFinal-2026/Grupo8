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

* Formatos y Saneamiento: Se verifica la correcta validación del EmailStr (mediante email-validator), la restricción de caracteres para el titular (solo letras, espacios, puntos, apóstrofes y guiones) y los límites del teléfono (8 a 15 dígitos numéricos), asegurando además que los espacios en blanco sean recortados.

* Fechas Relativas: Los tests de reservas (como test_reserva_normalizada.py) utilizan lógicas de fechas relativas a "hoy" (hora de Argentina) para evitar roturas temporales, asegurando que el ingreso no sea anterior a hoy y el egreso no sea anterior al ingreso.

* Ajustes de Capacidad: El test test_limite_de_capacidad se adaptó para inyectar y evaluar cantidades válidas (menores o iguales al máximo permitido) antes de forzar el fallo de aforo.


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