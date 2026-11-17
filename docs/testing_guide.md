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

### 1.6. Autenticación, Permisos y Cupo (Issue 13)

* **Login (`test_auth.py`):** ingreso con DNI y con correo (sin distinguir mayúsculas ni espacios), claims y duración del token (60 minutos, y 168 horas para el guardia), `GET /auth/me`, y que toda credencial inválida (usuario inexistente, contraseña incorrecta o muy larga, hash malformado) dé el mismo 401 sin revelar la causa.
* **Permisos (`test_autorizacion.py`):** las rutas de administrador responden 401 sin token, 403 con otro rol y 200 con `ADMIN`. Se prueba que el rol sale de la base y no del token, que se rechazan los tokens vencidos, sin firma, de otro algoritmo o con un `sub` inválido, y `require_role` con uno o varios roles. También cubre `bulk-sync`: 401 sin token o vencido, 403 para `ADMIN` y `CLIENTE` (sin guardar nada del lote) y 200 para el guardia.
* **Membresía y socios (`test_socios.py`, `test_admin_socios.py`):** los cuatro resultados de `GET /socios/validar/{dni}`, el borde del vencimiento con fecha fija (el día del vencimiento todavía vale), y el alta de socios (hash de la contraseña, 409 por DNI o correo repetido, 422 por datos inválidos y 401/403 según el rol). Un test verifica que Alembic tenga un único *head*.
* **Cupo (`test_capacity_service.py`):** casos límite de `lugares_ocupados` con una "hora actual" fija: canceladas, pendientes dentro y fuera del plazo, el límite exacto del plazo y un segundo después, plazo tomado de la configuración y solapamiento de fechas. `test_cupo_depende_del_estado_de_reserva_y_no_del_pago` lo comprueba por la API.
* **Fixtures:** los módulos que no prueban la autenticación usan `como_admin` o `como_guardia` (`conftest.py`), que reemplazan al usuario de la sesión solo durante el test y lo restauran al terminar.

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

### 2.4. Rutas Protegidas y Sesión (Issue 13.5)

* **`src/__tests__/rutasProtegidas.test.tsx`:** sin sesión, `/acceso` y `/admin` redirigen al login; con un rol incorrecto muestran "Acceso denegado" (y el enlace "Ir a mi pantalla" lleva a la del propio rol); con el rol correcto se entra. Cubre además el token vencido del guardia: con conexión se descarta y se pide el login, sin conexión la sesión se conserva, y para cualquier otro rol no se conserva.
* **`src/pages/admin/AdminRoutes.test.tsx`:** el panel solo se abre con `ADMIN`.
* **`src/services/syncService.test.ts`:** el lote viaja con el token en `Authorization`; sin sesión no se envía nada; un 401 conserva la cola, no reintenta y cierra la sesión; un 403 conserva la cola; y con un token nuevo la cola pendiente se sincroniza sin duplicar ingresos.

### 2.5. PWA del Guardia e Historial de Ingresos (Issue 26)

* **`src/hooks/useConexion.test.tsx`:** el contador sube al registrar ingresos y baja con `marcarComoSincronizados` sin que nadie le avise (IndexedDB en memoria); también eventos de red, `sync-status` y limpieza de listeners.
* **`src/services/dbService.test.ts` y `syncService.test.ts`:** alta en historial, recorte a 50 sin tocar la cola (con 51 ingresos), éxito parcial, envío de un ingreso que ya salió de la lista y hora de la última sincronización.
* **`src/db/db.migracion.test.ts`:** arma una base v3 con pendientes y montos, la abre con la v4 y comprueba que no se perdió nada.
* **Pantallas:** `HistorialAcceso`, `EstadoSincronizacion` (botón deshabilitado con motivo, envío, sesión vencida), `RegistroManual` (confirmación con el ID local) y `LayoutAcceso` (cinco opciones y `aria-current`).
* **`src/__tests__/rutasProtegidas.test.tsx`:** las cuatro rutas de la PWA por rol, sin conexión con el token vencido, y que `App` pone el título de la pestaña (si se pierde `<TituloDePagina />` en un merge, falla).
* **Backend (`tests/test_admin_ingresos_api.py`):** 401/403, hoy por defecto, bordes de medianoche de Buenos Aires, paginación sin filas repetidas, tipo de cliente y que un QR clonado no aparece. Usa `db_aislada`.


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

### 3.4. Corte de internet y cobro en efectivo con Playwright (Issue 24.2)

La prueba `frontend/pwa-acceso/e2e/offline-sync.spec.ts` corre con el mismo comando que la 3.3 (`npm run test:e2e`). Comprueba que el guardia puede trabajar sin conexión y que, al volver la red, todo llega al panel.

Qué hace:

1. Prepara por API una reserva pagada y obtiene su QR. Es el mismo camino que la 3.3 recorre por pantalla, pero más rápido.
2. El administrador anota la ocupación y el efectivo de partida. El guardia abre la app con internet, como al empezar el turno.
3. Se corta internet **solo en el navegador del guardia** (`context.setOffline(true)`). El backend y el panel siguen conectados.
4. La app se recarga sin conexión y abre igual, gracias al service worker.
5. Sin conexión, el guardia escanea el QR y registra un ingreso manual cobrado en efectivo. La prueba comprueba los mensajes de la pantalla y que, en ese momento, el panel no cambió: nada salió del celular.
6. Vuelve la conexión. La prueba espera la respuesta real del envío en lote (`POST /api/v1/ingresos/bulk-sync`), comprueba que el servidor confirmó los dos ingresos y recién después mira el panel.
7. El panel muestra la ocupación y el efectivo actualizados.

Decisiones:

* **`context.setOffline` y no `page.route`.** Es lo más parecido a un celular que pierde el 4G: el navegador pasa a `navigator.onLine = false`, dispara los eventos `offline` y `online` y corta también lo que pide el service worker. `page.route` solo simula un error en pedidos puntuales y no dispara esos eventos.
* **Sin esperas fijas.** No se usa `waitForTimeout`: la prueba avanza cuando llega la respuesta del servidor (`waitForResponse`) o cuando la pantalla muestra lo esperado.
* **Sin leer IndexedDB desde la prueba.** El guardado local se comprueba por lo que ve el guardia y porque, al reconectar, el lote enviado tiene exactamente esos dos ingresos.
* **Solo cambia el contexto del guardia.** El `request` de Playwright (con el que se arma la reserva) y el panel del administrador no se ven afectados por el corte.

Errores que encontró esta prueba y se corrigieron:

* **El service worker nunca se registraba.** `main.tsx` importaba `virtual:pwa-register` sin llamar a `registerSW()`, así que la app no abría si se recargaba sin internet (`ERR_INTERNET_DISCONNECTED`). Mientras la pestaña seguía abierta funcionaba, por eso las pruebas manuales de la 3.1 no lo detectaban.
* **Etiquetas sin asociar.** Faltaban etiquetas asociadas en el formulario de ingreso manual. Además, en el resumen de cobros cada total pasó a ser un grupo con nombre ("Efectivo", "Mercado Pago", "Total") para que un lector de pantalla lea el monto junto a su título.
* **Login por app.** Desde la 23.1 cada app tiene su propio login (`/login`, `/acceso/login`, `/admin/login`): las pruebas entran por el login de cada actor.

### 3.5. Cancelación de reservas con Playwright (Issue 24.3)

La prueba `frontend/pwa-acceso/e2e/cancellation.spec.ts` corre con el mismo comando (`npm run test:e2e`). La base de pruebas incluye un socio con la membresía al día.

**Bloque 1: plazo de cancelación.** Cada prueba fija el plazo en 3 días y el 50 % por la API del panel y prepara por API una reserva pagada a nombre del socio. Como esas reservas son de hoy, están dentro del plazo de arrepentimiento (25.1), que vale hasta el día anterior al ingreso:

* **Ingreso mañana.** Último día del arrepentimiento. Por las reglas del camping ya estaría fuera de plazo, pero rige el arrepentimiento: el diálogo dice "Estás dentro del plazo de arrepentimiento: se te devuelve el total." y "100 % de lo que pagaste", el socio cancela, ve el mensaje con la devolución y la reserva pasa a Canceladas.
* **Ingreso hoy.** El arrepentimiento ya no rige y por el plazo de 3 días está vencido: el diálogo muestra exactamente "Lo sentimos, las reservas solo se pueden cancelar hasta 3 días antes del ingreso." y no ofrece confirmar. Además, la prueba comprueba que el backend también rechaza la cancelación directa (422 con el mismo mensaje).

El porcentaje del camping fuera del arrepentimiento (reservas hechas hace más de 10 días) se prueba en `backend/tests/test_cancelacion_reservas.py`: por API no se puede crear una reserva con fecha de hace días.

**Bloque 2: el QR cancelado se rechaza en la puerta sin internet.**

1. Con plazo 0, el socio cancela desde la web una reserva de hoy.
2. El guardia abre la app. La prueba comprueba que el servidor le mandó esa reserva en la lista de canceladas.
3. El guardia pierde internet y escanea el QR. Aparece "Reserva Cancelada / Acceso Revocado" (con ícono y en rojo) y la capacidad disponible no cambia.
4. Al volver internet no se envía ningún ingreso y la ocupación del panel no cambia.

Socio, guardia y administrador usan contextos de navegador separados: cada uno tiene su propia sesión y su propio almacenamiento.

Decisiones:

* **Sin manipular el reloj.** El plazo lo calcula el backend con la fecha de Argentina, así que cambiar el reloj del navegador (`page.clock`) no cambia el resultado. Se fija el plazo y se crean reservas con fechas relativas a hoy, justo en el límite del arrepentimiento (día anterior al ingreso y mismo día).
* **Reserva de hoy en el Bloque 2.** Así el QR solo puede rechazarse por estar cancelado, y el mensaje que se comprueba es distinto del de "QR inválido".
* **Cada tarjeta de Mis reservas tiene nombre accesible** ("Reserva" más los primeros 8 caracteres del id), para encontrar la reserva correcta aunque el socio tenga varias.

Pendientes detectados (no se modificaron porque están fuera del alcance):

* La lista de canceladas solo se descarga al abrir la app o al volver la conexión. Si el guardia tiene la app abierta desde antes de la cancelación y pierde la red sin recargar, el QR cancelado se acepta.
* La PWA no revisa la fecha de ingreso del QR (`dat`), solo el vencimiento: el QR de una reserva futura se acepta hoy.

### 3.5.1. Botón de arrepentimiento con Playwright (Issue 25.3)

La prueba `frontend/pwa-acceso/e2e/arrepentimiento.spec.ts` corre con el mismo comando. Prepara por API dos reservas pagadas del mismo email (con ingreso en 3 y en 5 días, así están dentro del plazo de arrepentimiento) y después, como visitante y sin iniciar sesión:

* Entra desde el enlace "Botón de arrepentimiento" del pie, escribe el email y ve "Si hay reservas con ese email, te enviamos un correo con un enlace para cada una."
* Lee el correo en el Resend falso y comprueba que trae un enlace distinto por reserva.
* Abre el enlace de una de las reservas, ve las condiciones (100 % por arrepentimiento) y confirma: aparece "Reserva cancelada" con el código de gestión.
* Comprueba por API que el enlace de la otra reserva todavía permite cancelarla, y que volver a abrir el enlace usado muestra "La reserva ya está cancelada."

`crearReservaPagada` acepta la opción `email` para repetir el mismo email en varias reservas; por eso `esperarQrDelCorreo` busca el correo con el QR por el id de la reserva.

### 3.6. Accesibilidad automática con axe y jsx-a11y (Issue 27.1)

El objetivo es que las tres apps cumplan WCAG 2.2 nivel AA (cumplir la 2.2 implica cumplir la 2.0 y la 2.1, que es la que toma la Ley 26.653). Hay dos revisiones automáticas que se complementan:

| Revisión | Qué mira | Cuándo corre |
|---|---|---|
| `eslint-plugin-jsx-a11y` | El código de los componentes: etiquetas sin asociar, imágenes sin `alt`, clics en elementos que no son botones, roles ARIA inválidos | En cada PR (CI) y a mano con `npm run lint:a11y` |
| `@axe-core/playwright` | La pantalla ya dibujada en el navegador: contraste, nombres accesibles, estructura de títulos, idioma | Con las pruebas E2E (`npm run test:e2e`) |

#### Lint de accesibilidad

Desde `frontend/pwa-acceso`:

```bash
npm run lint:a11y
```

Revisa `src/**/*.tsx` (sin los tests) con las reglas recomendadas de jsx-a11y. Los componentes de shadcn/ui (`Button`, `Input`, `Label`, `Textarea`) se revisan como el elemento HTML que dibujan. Las reglas están en `eslint.a11y.config.js` y `eslint.config.js` también las incluye, así que `npm run lint` las corre junto con el resto.

En el CI corre solo `lint:a11y` porque el lint completo todavía tiene errores de formato de Prettier que no son parte de esta issue.

#### Pruebas con axe

La prueba `frontend/pwa-acceso/e2e/accesibilidad.spec.ts` corre con el mismo comando que las demás (`npm run test:e2e`). Para correr solo esta:

```bash
npx playwright test accesibilidad
```

Abre cada pantalla como lo haría una persona (con el login que corresponda), comprueba el título de la pestaña y corre axe con las reglas de WCAG 2.0, 2.1 y 2.2 A y AA:

* Web de reservas: Home, Reservas, Mis reservas y botón de arrepentimiento.
* Panel: inicio, Gestión de reservas e Historial de ingresos.
* PWA del guardia: escáner e historial.

La prueba falla si axe encuentra problemas **graves o críticos**. Los moderados y leves no la hacen fallar, pero aparecen como anotaciones en el informe. El detalle completo de cada pantalla queda adjunto en el informe HTML (`npm run test:e2e:informe`, archivo `axe-problemas.json`).

Una pantalla que todavía no está integrada se marca con `pendiente` y Playwright la muestra como salteada; al integrarla se borra esa línea.

Desde la 27.2 la prueba también revisa Disponibilidad, Reservas con los errores a la vista, Iniciar sesión, Mi perfil, Beneficios, Acerca de y Contacto. Además, tiene tres pruebas de teclado de la web de reservas:

* El primer Tab muestra "Saltar al contenido" y Enter lleva el foco al contenido.
* Al enviar la reserva con errores, el foco va al primer campo con error y el campo tiene su error como descripción accesible.
* El diálogo de cancelación se abre con Enter, Tab no saca el foco del diálogo y Esc lo cierra devolviendo el foco al botón "Cancelar".

Desde la 27.3 también revisa las secciones del panel (Socios, Egresos, Descuentos, Tipos de reserva, Configuración, Alertas, el formulario de socios con errores y el login del panel) y suma tres pruebas de teclado del panel:

* "Saltar al contenido" deja atrás el menú lateral.
* "Ver detalle" abre la reserva en una ventana con el foco adentro, y Esc la cierra devolviendo el foco al botón.
* "Editar" en un socio lleva el foco al primer campo y "Cancelar" lo devuelve al botón de la fila.

Desde la 27.4 también revisa la PWA del guardia: el escáner abierto, el escáner con un resultado a la vista, Registro manual, Estado de sincronización y el login del guardia. Suma tres pruebas de teclado de la PWA:

* "Escanear QR" con Enter lleva el foco a la indicación; con Tab se llega al campo del token, y al validar el resultado se anuncia y el foco vuelve a "Escanear QR".
* La barra inferior se usa con el teclado: lleva el foco a la pantalla elegida y la marca con `aria-current`.
* Las cinco opciones de la barra inferior miden al menos 24 × 24 px (WCAG 2.5.8).

Lo que se cumple en cada app y las diferencias que quedan con WCAG 2.2 AA están en `docs/accesibilidad.md`.

#### Títulos de la pestaña

Cada pantalla tiene su propio título (WCAG 2.4.2), por ejemplo "Mis reservas | Qamp", "Escáner | Qamp Acceso" o "Gestión de reservas | Qamp Panel". Se arman en un solo lugar, `src/lib/titulos.ts`, y los aplica `TituloDePagina` desde `App.tsx`. Los del panel salen de `pages/admin/routes.tsx`, así que una pantalla nueva del panel ya tiene título. Para una pantalla nueva de la web o de la PWA, se agrega su ruta en `titulos.ts`.

#### Errores habituales

* `ERESOLVE unable to resolve dependency tree` al instalar: `eslint-plugin-jsx-a11y` todavía no declara compatibilidad con ESLint 10, aunque funciona. El `overrides` de `package.json` lo resuelve; si aparece, revisar que siga ahí.
* `A form label must be associated with a control`: el `Label` necesita `htmlFor` con el `id` del campo.
* La prueba de axe falla con `color-contrast`: el color de texto no llega a 4,5:1 sobre su fondo (3:1 en textos grandes). Se corrige en la paleta común de la 24.5.

## 4. Entorno de Integración Continua (CI/CD)

El sistema valida ambas bases de código antes de cualquier integración en la rama principal (`main` o `dev`) utilizando GitHub Actions (`.github/workflows/test.yml`).

### 4.1. Configuración de la Pipeline

* El flujo consta de dos *jobs* paralelos (`backend-tests` y `frontend-tests`), eliminando la necesidad de archivos separados.

* **Job Backend:** Levanta un servicio auxiliar de PostgreSQL 15 con credenciales de prueba e inicializa un chequeo de salud continuo (`pg_isready`). Instala Pipenv y ejecuta el script de generación de claves ES256 antes de correr `pytest`.

* **Job Frontend:** Emplea Node.js 20.19.0, instala dependencias estructuradas (`npm ci`), corre el lint de accesibilidad (`npm run lint:a11y`), compila la validación estricta de TypeScript (`npm run build`) y ejecuta toda la suite de `vitest` en memoria usando `fake-indexeddb` sin requerir base de datos externa.


### 4.2. Umbrales de Cobertura y Bugs Detectados

* El pipeline backend exige explícitamente una cobertura mínima de código del 80% configurada mediante `pytest-cov` en los archivos `Pipfile` y `pyproject.toml`.

* Existen exclusiones justificadas de cobertura para archivos de migración Alembic, scripts de *seeding* (como `seed.py` o `seed_qr.py`) y los propios archivos de test.

* Durante el desarrollo de la cobertura de la sincronización masiva se expusieron y repararon bugs genuinos de producción. Destaca la detección de la falta de orden FIFO real en la consulta IndexedDB original (corregido aplicando un `.sort()` explícito de `fecha_escaneo`) y un error de tipo crítico en el modelo de auditoría `conflictos.py` (corregido cambiando la tipificación a `UUID` e integrando el modelo con la base declarativa de SQLAlchemy). Tras añadir los tests y soluciones, la cobertura final de la arquitectura API backend alcanzó el 91.11%.