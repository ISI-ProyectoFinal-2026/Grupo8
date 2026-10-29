# Contratos del Sprint 4 (Día 0)

Documento de acuerdos para trabajar en paralelo. Define las reglas de integración, los endpoints y los modelos de datos compartidos.

**Regla de cambios:** un contrato solo cambia mediante un PR aprobado por quien lo consume. Si el código y este documento difieren, el PR debe actualizar la documentación y los tipos afectados en el mismo cambio.

## 0. Dueños y límites de trabajo

| Responsable | Dominio | Archivos y responsabilidades principales |
|---|---|---|
| P1 | Autenticación y socios | `/auth/*`, `/socios/*`, `/admin/socios`, `core/dependencies.py`, validación de socios y migración de `usuarios` |
| P2 | Reservas, cotización y descuentos | `/tipos-reserva`, `/reservas/cotizar`, `/reservas/mias`, `POST /reservas`, `/admin/descuentos`, `PricingService` y payload QR del backend |
| P3 | Integración y pantallas web | `App.tsx`, `AuthContext`, `src/lib/api.ts`, `AdminLayout`, `src/pages/admin/routes.tsx` |
| P4 | Ingresos offline e incidentes | `bulk-sync`, `/admin/incidentes`, `syncService.ts` y PWA `/acceso` |

## 1. Decisiones cerradas

| ID | Decisión |
|---|---|
| D1 | El precio inicial se configura por tipo de reserva y por día, por persona. Los valores iniciales son de referencia y deben confirmarse con el camping, especialmente para cabañas. |
| D2 | Días cobrados = diferencia entre fecha de egreso e ingreso + 1. Mismo día = 1 día; una noche = 2 días. |
| D3 | Si Mercado Pago informa un pago aprobado después del vencimiento, se registra y se confirma la reserva, aunque exista riesgo de sobreventa. Ver §6. |
| D4 | Se utiliza un único tipo de QR para socios y visitantes. El QR nuevo informa cantidad de personas y cantidad de socios. Los QR antiguos siguen siendo válidos. Ver §7. |
| D5 | Por persona se aplica un solo descuento: el mayor de los descuentos activos aplicables. No se acumulan. |
| D6 | El backend es la única fuente de cálculo de precios y descuentos. El frontend muestra el resultado de `/reservas/cotizar` y no recalcula importes. |
| D7 | El dinero se calcula con `Decimal`, se redondea por persona a dos decimales con regla mitad hacia arriba y se serializa como número JSON con dos decimales. |
| D8 | Fechas y horas se intercambian en ISO 8601 UTC con `Z`. Las columnas `DateTime` sin zona guardan UTC. La hora argentina se usa para mostrar fechas y calcular “hoy”. |
| D9 | Los enums se envían por nombre, no por índice numérico. No se cambia el contrato existente de `ReservaResponse` en este sprint. |
| D10 | Los descuentos por membresía o edad se administran desde el dashboard. Los porcentajes no se codifican de forma fija en el frontend. |

**Pendiente de confirmación funcional:** verificar con el camping si la cabaña se cobra por persona o por unidad. Hasta resolverlo, se mantiene el supuesto actual de precio por persona por día. Los precios iniciales de `entrada_general`, `carpa` y `cabana` son valores de seed/mock, no tarifas confirmadas.

## 2. Autenticación, roles y socios (P1)

### 2.1 Reglas de autenticación

- El login recibe un único campo `identificador`: si contiene `@`, se interpreta como email; de lo contrario, como DNI.
- JWT firmado con `HS256` usando `AUTH_SECRET_KEY`.
- Claims mínimos: `sub` (UUID del usuario), `rol`, `iat` y `exp`.
- El backend vuelve a consultar el rol en la base de datos en cada request; el claim de rol sirve para la interfaz, no como única autorización.
- Roles válidos: `ADMIN`, `SEGURIDAD`, `CLIENTE`.
- Contraseñas con `bcrypt`, mínimo 8 caracteres. Un `password_hash` de prueba inválido, como `"!"`, debe tratarse como credencial inválida sin lanzar una excepción.
- Duración por defecto: socios y administradores, 60 minutos; guardia, 168 horas.
- El registro público y la recuperación de contraseña no forman parte de este sprint.

### 2.2 Endpoints y respuestas

```http
POST /auth/login
Content-Type: application/json
```

Request:
```json
{
  "identificador": "41234567",
  "password": "********"
}
```

Respuesta `200`:
```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "expires_in": 3600,
  "usuario": {
    "id": "uuid",
    "nombre": "Ana Pérez",
    "email": "ana@correo.com",
    "dni": "41234567",
    "rol": "CLIENTE",
    "is_socio": true,
    "membresia_vigente": true,
    "membresia_vence": "2026-12-31"
  }
}
```

- `GET /auth/me` devuelve el mismo objeto `usuario`.
- Credenciales inválidas devuelven `401 {"detail":"Credenciales inválidas"}` tanto si el usuario no existe como si la contraseña es incorrecta.
- La membresía está vigente si `is_socio` es verdadero y `membresia_vence >= hoy` en fecha argentina. `estado_cuota` queda como legado.

Validación pública de socio:

```http
GET /socios/validar/{dni}
```

Respuesta con socio vigente:
```json
{
  "valido": true,
  "motivo": null,
  "nombre": "Ana Pérez",
  "condicion": "socio"
}
```

Respuesta con socio no válido:
```json
{
  "valido": false,
  "motivo": "CUOTA_VENCIDA",
  "nombre": null,
  "condicion": null
}
```

- `motivo` puede ser `NO_EXISTE` (ningún usuario con ese DNI), `NO_ES_SOCIO` o `CUOTA_VENCIDA`.
- `nombre` y `condicion` solo se informan cuando `valido` es verdadero; `condicion` vale `socio`. En los demás casos el endpoint no devuelve ningún dato personal.
- La regla de vigencia es `is_socio` y `membresia_vence >= hoy` (fecha argentina): el día del vencimiento todavía es válido. Un socio sin `membresia_vence` figura como `CUOTA_VENCIDA`.
- `estado_cuota` está en desuso y no se usa para decidir.
- La lógica vive en `services/socio_service.py` (`validar_socio(db, dni)`), para que la reutilice la Issue 14.
- El rate limiting queda fuera del alcance de este sprint.

Alta y listado de socios (solo `ADMIN`):

```http
POST /admin/socios
GET /admin/socios
```

Ejemplo de alta:
```json
{
  "nombre": "Ana Pérez",
  "dni": "41234567",
  "email": "ana@correo.com",
  "password": "inicial123",
  "membresia_vence": "2026-12-31"
}
```

`POST /admin/socios` devuelve `201` con `SocioOut`; devuelve `409` si el DNI o el email ya existen. `GET /admin/socios` devuelve `SocioOut[]`.

- Solo `ADMIN`; los demás roles reciben `403` y sin token, `401`.
- El alta crea siempre un usuario con `rol = CLIENTE` e `is_socio = true`; cualquier otro valor enviado en el body se ignora. `membresia_vence` es obligatoria.
- Validaciones (las mismas que `validaciones.ts`): `nombre` de 2 a 100 caracteres (letras, espacios, puntos, apóstrofes y guiones), `dni` de 7 u 8 dígitos, `email` válido, `password` de 8 a 72 bytes. Un dato inválido devuelve `422`.
- El email se guarda en minúsculas y la comparación de duplicados no distingue mayúsculas, igual que el login.
- `SocioOut`: `id`, `nombre`, `dni`, `email`, `membresia_vence` y `membresia_vigente`. El listado incluye a los socios con la cuota vencida, ordenados por nombre.

### 2.3 Schemas y tipos compartidos

Los modelos ejecutables se mantienen en código. Esta documentación describe su finalidad y el contrato visible para el consumidor; no reemplaza la validación de Pydantic ni los tipos de TypeScript.

| Modelo | Ubicación / lado | Contrato |
|---|---|---|
| `LoginRequest` | Backend y frontend | `identificador: string`, `password: string` |
| `UsuarioSesion` | Backend y frontend | `id`, `nombre`, `email`, `dni`, `rol`, `is_socio`, `membresia_vigente`, `membresia_vence` |
| `LoginResponse` | Backend y frontend | `access_token`, `token_type`, `expires_in`, `usuario: UsuarioSesion` |
| `SocioCreate` | Backend | `nombre`, `dni`, `email`, `password`, `membresia_vence` |
| `SocioOut` | Backend y frontend cuando se lista/crea | Datos de salida del socio; nunca incluye el password en claro |
| `SocioValidacion` | Backend y frontend consumidor | `valido: boolean`, `motivo: NO_EXISTE \| NO_ES_SOCIO \| CUOTA_VENCIDA \| null`, `nombre: string \| null`, `condicion: "socio" \| null` |

Archivos ejecutables:
- Backend: `backend/schemas/auth.py`.
- Tipos TypeScript: `frontend/pwa-acceso/src/types/contratos.ts`.

Frontend:
- El token se guarda bajo `qamp_token`.
- `AuthContext` mantiene la sesión y `src/lib/api.ts` expone `apiFetch`, que agrega `Authorization: Bearer <token>`.
- Un `401` con token debe emitir `qamp:auth-expired`.
- En la sincronización offline, un `401` pausa el envío y conserva la cola; se muestra “Iniciá sesión de nuevo para sincronizar”.
- Rutas de la interfaz: sin sesión, `/acceso` y `/admin/*` redirigen a `/login`; con una sesión de otro rol muestran “Acceso denegado”. `/acceso` es solo para `SEGURIDAD` y `/admin/*` solo para `ADMIN`.

## 3. Cotización, reservas y descuentos (P2)

### 3.1 Reglas de cálculo

```text
dias = (fecha_egreso - fecha_ingreso).days + 1
bruto_persona = tipo.precio_por_dia * dias
pct_persona = mayor porcentaje entre descuentos activos aplicables; si no hay, 0
precio_persona = redondear2(bruto_persona * (100 - pct_persona) / 100)
total = suma(precio_persona de todas las personas)
```

- `entrada_general` no permite noches: `fecha_egreso` debe ser igual a `fecha_ingreso`.
- Respetar `MAX_NOCHES_POR_RESERVA` y `MAX_PERSONAS_POR_RESERVA`.
- El precio y el descuento se calculan por persona; el redondeo se aplica a cada precio final individual antes de sumar.
- Los descuentos activos se administran desde el dashboard y pueden aplicar por condición de socio o por rango de edad. El backend decide qué descuento corresponde y aplica solo el mayor.
- Los porcentajes que hoy aparezcan fijos en `Beneficios.tsx`, `Reservas.tsx` u otras pantallas se eliminan; el frontend consume la configuración y la cotización del backend.
- La condición de socio se valida contra el estado de membresía. En `/reservas/cotizar`, un socio inválido o con cuota vencida se cotiza como visitante y se devuelve el motivo. En `POST /reservas`, el mismo caso devuelve `422` para impedir cobrar un importe distinto al que se mostró.

### 3.2 Endpoints

```http
GET /tipos-reserva
POST /reservas/cotizar
POST /reservas
GET /reservas/mias
GET /admin/descuentos
POST /admin/descuentos
PUT /admin/descuentos/{id}
```

- `GET /tipos-reserva` es público y reemplaza los precios mockeados de `Disponibilidad.tsx`.
- `POST /reservas/cotizar` es público y no persiste una reserva.
- `POST /reservas` crea la reserva. El titular es la primera persona (`personas[0]`) y `user_id` no se recibe en el body: se obtiene del usuario autenticado si existe; en una reserva sin sesión queda `null`.
- `cantidad_personas = len(personas)`. El request no incluye `telefono`.
- `GET /reservas/mias` requiere autenticación y devuelve `ReservaDetalle[]`, incluyendo personas, cantidad de socios y si el pago fue tardío.
- Las operaciones `/admin/descuentos` requieren rol `ADMIN`. El administrador configura el porcentaje, el rango de edad cuando corresponda y si el descuento está activo.
- `PricingService.cotizar(...)` es la única implementación del cálculo; lo usan `/reservas/cotizar` y `POST /reservas`. `payments/create` cobra `reserva.monto_total`.

Ejemplo de request para cotizar:

```json
{
  "fecha_ingreso": "2026-12-20",
  "fecha_egreso": "2026-12-22",
  "tipo_reserva": "carpa",
  "personas": [
    {"edad": 34, "condicion": "socio", "dni": "41234567"},
    {"edad": 8, "condicion": "visitante"}
  ]
}
```

Ejemplo de respuesta de cotización (ilustrativo; los valores dependen de las tarifas y descuentos configurados):

```json
{
  "moneda": "ARS",
  "tipo_reserva": "carpa",
  "dias": 3,
  "subtotal": 30000.00,
  "descuento_total": 7500.00,
  "total": 22500.00,
  "cantidad_socios": 1,
  "detalle": [
    {
      "indice": 0,
      "condicion_efectiva": "socio",
      "descuento_codigo": "socio",
      "descuento_pct": 20.0,
      "precio_base_dia": 5000.0,
      "dias": 3,
      "subtotal": 15000.0,
      "precio_final": 12000.0,
      "motivo": null
    }
  ]
}
```

Ejemplo de request de creación:

```json
{
  "fecha_ingreso": "2026-12-20",
  "fecha_egreso": "2026-12-22",
  "tipo_reserva": "carpa",
  "email": "ana@correo.com",
  "personas": [
    {
      "nombre": "Ana Pérez",
      "edad": 34,
      "condicion": "socio",
      "dni": "41234567"
    }
  ]
}
```

### 3.3 Schemas y tipos compartidos

| Modelo | Contenido / reglas |
|---|---|
| `TipoReservaOut` | Tipo de lugar, código/nombre, `precio_por_dia`, `permite_noches` y `activo` |
| `Descuento` | Configuración de descuento: código, nombre, porcentaje, aplicación por socio o edad, límites de edad cuando corresponda y estado activo |
| `PersonaCotizar` | Datos para cotizar una persona: edad, condición y DNI cuando se declara socio |
| `PersonaReserva` | Datos para confirmar la reserva: nombre, edad, condición y DNI cuando corresponde |
| `CotizarRequest` | Fechas de ingreso/egreso, tipo de reserva y lista de `PersonaCotizar` |
| `CotizarDetalle` | Detalle por persona: condición efectiva, descuento aplicado, porcentaje, precio base, días, subtotal, precio final y motivo de ajuste |
| `CotizarResponse` | Moneda, tipo, días, subtotal, descuento total, total, cantidad de socios y detalle |
| `ReservaCrear` / `ReservaCrearV2` | Payload de creación: fechas, tipo, email y lista de `PersonaReserva`; no recibe `user_id` |
| `PersonaOut` | Datos de salida de una persona asociada a la reserva, incluyendo el descuento y precio final persistidos |
| `ReservaDetalle` | Reserva procesada, estado de pago, titular, cantidades de personas/socios y lista de `PersonaOut` |

Archivos ejecutables:
- Backend: `backend/schemas/cotizacion.py` (y el schema de reservas que el proyecto tenga definido para la versión activa).
- Frontend: `frontend/pwa-acceso/src/types/contratos.ts`.

**Regla de persistencia:** los detalles por persona guardan una fotografía (`snapshot`) del descuento y del precio aplicado al momento de reservar. Cambiar la configuración del descuento no modifica reservas anteriores.

### 3.4 Persistencia: resumen funcional

- `tipos_reserva`: catálogo de tipos, precio por día, si admite noches y estado activo. Se cargan los valores iniciales por seed/migración; la edición de tarifas desde el dashboard queda fuera de alcance de este sprint.
- `descuentos`: reglas configurables por el administrador. El descuento `socio` puede desactivarse, pero no eliminarse.
- `reserva_personas`: detalle por persona con nombre, edad, DNI cuando corresponda, condición de socio, código/porcentaje de descuento y precio final.
- `reservas`: incorpora tipo de reserva, cantidad de socios, `pago_tardio`, fecha de confirmación de pago y estado previo para incidentes. `user_id` es nullable; `telefono` puede permanecer en base por compatibilidad, pero deja de formar parte del contrato de creación.

## 4. Ingresos offline, QR, sincronización e incidentes (P4)

### 4.1 Autorización y procesamiento

- `POST /api/v1/ingresos/bulk-sync` requiere rol `SEGURIDAD`. Sin token responde `401` y con otro rol (incluido `ADMIN`) responde `403`; en ambos casos no se guarda nada del lote.
- El backend procesa cada ítem de manera independiente. Un ítem inválido no rechaza el lote completo.
- La solicitud admite hasta 500 ítems.
- Cada ingreso tiene un `jti` único. La restricción `UNIQUE` en `ingresos_fisicos.jti` es la protección definitiva ante sincronizaciones concurrentes.
- Para ingresos manuales, generar `jti = "manual-" + crypto.randomUUID()` una sola vez al registrar el ingreso; conservarlo en todos los reintentos.
- En `errores[].permanente`, `true` significa que la PWA puede quitar ese ítem de la cola; `false` significa que debe reintentarlo.
- Si la API devuelve `401`, no se borra ni descarta la cola: se pausa la sincronización hasta volver a iniciar sesión.
- La PWA envía `Authorization: Bearer <token>` en cada lote. Si no hay token guardado, no envía nada y conserva la cola.

#### Sesión del guardia y token vencido sin conexión

- El token del guardia dura 168 horas (7 días), configurable con `GUARD_TOKEN_EXPIRE_HOURS`. Socios y administradores usan 60 minutos.
- Sin conexión el vencimiento no interrumpe el trabajo: escanear QR, validarlos e ingresar personas a mano son operaciones locales que no usan el token. Los ingresos quedan en la cola de IndexedDB.
- Si la app se vuelve a abrir sin conexión con el token vencido, el guardia conserva su sesión en `/acceso`, porque sin red no podría iniciar sesión de nuevo. Esta excepción es solo para el rol `SEGURIDAD`; con conexión, un token vencido se descarta y se pide el login, como para cualquier otro rol.
- Al volver la conexión, `bulk-sync` responde `401`. La PWA pausa el envío (sin reintentos con backoff, porque con el mismo token fallarían igual), conserva toda la cola, muestra “Iniciá sesión de nuevo para sincronizar” y cierra la sesión para llevar al guardia al login.
- Después de iniciar sesión, la cola se envía en el siguiente evento `online` o en el chequeo periódico de 5 minutos, ya con el token nuevo. No se pierde ningún ingreso y el `jti` se conserva, por lo que un reintento no duplica registros.
- El backend es quien decide: aunque la interfaz conserve la sesión, un token vencido nunca es aceptado por la API.

### 4.2 Request y response de bulk-sync

```http
POST /api/v1/ingresos/bulk-sync
```

Request de ejemplo:
```json
{
  "ingresos": [
    {
      "jti": "uuid-del-qr",
      "tipo": "QR",
      "reserva_id": "uuid",
      "fecha_escaneo": "2026-12-20T14:03:11Z",
      "cantidad_personas": 3
    },
    {
      "jti": "manual-3f9c...",
      "tipo": "MANUAL",
      "reserva_id": null,
      "fecha_escaneo": "2026-12-20T14:10:02Z",
      "cantidad_personas": 2,
      "monto_cobrado": 10000.00,
      "nombre": "Juan Gómez",
      "dni": "30111222"
    }
  ]
}
```

Respuesta de ejemplo:
```json
{
  "procesados": 1,
  "conflictos": 0,
  "sincronizados_jti": ["manual-3f9c..."],
  "errores": [
    {
      "jti": "uuid-del-qr",
      "motivo": "Reserva no encontrada",
      "permanente": true
    }
  ]
}
```

### 4.3 Schemas y tipos compartidos

| Modelo | Contrato |
|---|---|
| `IngresoSyncItem` | Un ingreso `QR` o `MANUAL`. Para QR exige `reserva_id`; para manual, `reserva_id` puede ser `null` y se requieren nombre y monto cobrado. Incluye `jti`, fecha ISO 8601 UTC y cantidad de personas; el DNI es opcional si el flujo lo permite. |
| `SyncRequest` | Lista `ingresos` de hasta 500 `IngresoSyncItem` |
| `SyncError` | `jti`, motivo y `permanente: boolean` para decidir si se elimina o reintenta el ítem |
| `SyncResponse` | Cantidades procesadas y en conflicto, lista de `jti` sincronizados y errores individuales |
| `QrPayload` | Payload del QR actual y compatibilidad con el formato legado |
| `IncidenteOut` | Datos del incidente para consulta administrativa, incluido el estado y datos de detección |
| `IncidenteResuelto` | Resultado de resolver un incidente |

Archivo ejecutable del backend: `backend/schemas/ingresos.py`. Los tipos TypeScript compartidos se declaran en `frontend/pwa-acceso/src/types/contratos.ts`.

### 4.4 QR actual y compatibilidad

Payload nuevo:

```json
{
  "jti": "uuid",
  "reserva_id": "uuid",
  "camping_id": "CAMP-MENDOZA-01",
  "iat": 0,
  "exp": 0,
  "dat": "2026-12-20",
  "typ": "reserva",
  "cantidad_personas": 4,
  "cantidad_socios": 2
}
```

- El JWT del QR se firma con ES256. `typ` del formato nuevo es siempre `"reserva"`.
- `cantidad_socios` está entre `0` y `cantidad_personas` y cuenta a quienes tenían membresía vigente al momento de reservar.
- Los QR ya emitidos con `typ: "socio"` o `typ: "visitante"` y sin `cantidad_socios` siguen siendo válidos. La PWA los acepta y no muestra el recuento de socios cuando ese dato no existe.
- La PWA nueva muestra “Ingreso confirmado — N personas, M socios”.
- P2 actualiza el schema del payload y los puntos donde se genera el QR; P4 actualiza `QrPayload`/`IJwtPayload` y la pantalla de control de acceso. El correo puede incluir el recuento de socios, pero es opcional.

### 4.5 Incidentes y clonación

- El estado `ALERTA_CLONACION` se agrega al enum de estado de reserva.
- Al detectar un QR repetido, se registra un incidente y se guarda el estado previo de la reserva.
- Una reserva en `ALERTA_CLONACION` sigue ocupando cupo.
- Resolver el incidente restaura el estado previo guardado.
- Si un pago se confirma mientras la reserva está en alerta, se registra el pago pero no se sobrescribe `ALERTA_CLONACION`; se actualiza `estado_previo` al estado al que debería volver.
- `GET /admin/incidentes` requiere `ADMIN` y devuelve `IncidenteOut[]`.
- `POST /admin/incidentes/{reserva_id}/resolver` requiere `ADMIN` y devuelve `IncidenteResuelto`.

## 5. Pago aprobado después del vencimiento (D3)

- “Vencida” no es un estado nuevo: es una reserva `PENDIENTE` cuya antigüedad supera `RESERVA_PENDIENTE_TTL_MINUTES`.
- Una reserva pendiente vencida deja de ocupar cupo, pero no se borra ni se cancela automáticamente.
- Si el webhook o `reconcile` de Mercado Pago informa `approved`, la reserva se confirma aunque esté vencida o ya no haya cupo. Si estaba vencida, se marca `pago_tardio = true`, se guarda `pago_confirmado_en`, se genera el QR, se envía el correo y se registra un `logger.warning`.
- Se acepta expresamente el riesgo de sobreventa puntual porque el pago aprobado es real.
- `payments/create` sobre una reserva vencida se permite solo si aún hay cupo, revalidando la disponibilidad y excluyendo la propia reserva. Si no hay cupo, devuelve `409` con el mensaje `La reserva venció y ya no hay cupo`.
- No configurar expiración de la preferencia de Mercado Pago en este sprint: los pagos en efectivo pueden acreditarse días después.
- `webhook` y `reconcile` deben utilizar la lógica común `marcar_como_pagada()` sin pisar una alerta de clonación.

## 6. Tipos globales, enums y formato

Los enums se intercambian como strings por nombre:

| Dominio | Valores |
|---|---|
| Rol | `ADMIN`, `SEGURIDAD`, `CLIENTE` |
| Condición de persona | `visitante`, `socio` |
| Tipo de ingreso | `QR`, `MANUAL` |
| Estado de reserva | `PENDIENTE`, `CONFIRMADA`, `CANCELADA`, `FINALIZADA`, `ALERTA_CLONACION` |
| Estado de pago | `PENDIENTE`, `PAGADO`, `CANCELADO` |
| Tipo de QR nuevo | `reserva` |

- Las fechas de reserva se representan como `YYYY-MM-DD`.
- Los timestamps se representan en ISO 8601 UTC, por ejemplo `2026-12-20T14:03:11Z`.
- Los importes se expresan en ARS, salvo que la respuesta indique otra moneda.
- Los ejemplos de esta documentación son ilustrativos. Los schemas ejecutables y las respuestas reales de la API determinan los campos obligatorios y opcionales vigentes.

## 7. Integración frontend

- P3 es responsable de `App.tsx`, `AuthContext`, `src/lib/api.ts` y `AdminLayout`. Las rutas administrativas se declaran en `src/pages/admin/routes.tsx`; cada pantalla agrega una entrada allí. Nadie más modifica `App.tsx` sin coordinar con P3.
- Las llamadas HTTP de la web pasan por `apiFetch`, para centralizar URL, headers y tratamiento de errores.
- `syncService.ts` puede conservar su `fetch` específico para sincronización offline, pero debe enviar `Authorization` y respetar la regla del `401` de §2.
- El frontend no define precios ni porcentajes de descuento fijos; muestra el resultado del backend.

| Ruta | Responsable de integración | Archivo principal |
|---|---|---|
| `/admin` (inicio y banner de alertas) | P3 para el contenedor; P4 para el componente | `pages/admin/Inicio.tsx`, `components/admin/AlertasClonacion.tsx` |
| `/admin/socios` | P1 | `pages/admin/Socios.tsx` |
| `/admin/descuentos` | P2 | `pages/admin/Descuentos.tsx` |
| `/admin/incidentes` | P4 | `pages/admin/Incidentes.tsx` |

## 8. Migraciones y configuración: reglas de coordinación

Los detalles de implementación de migraciones y variables de entorno se gestionan en las issues técnicas y la documentación de despliegue. El contrato común conserva estas reglas:

- Orden de integración previsto: migración de P1 (`usuarios`) → P2 (tipos, descuentos, personas y reservas) → P4 (ingresos, enum e incidentes). Coordinar cambios si cambia el orden.
- Antes de integrar una migración, rebasar sobre `dev` y actualizar `down_revision` al head vigente. Debe existir un único head de Alembic (`alembic heads` debe mostrar una sola línea).
- Una migración por PR; cada migración debe incluir `downgrade()` y el backfill necesario para datos existentes.
- Los modelos nuevos deben importarse desde `models/__init__.py` para que Alembic los detecte.
- Los tests que usan `create_all` no actualizan una base local ya creada. Al incorporar cambios de modelos, resetear la base local mediante el procedimiento del proyecto.
- Los cambios de enum PostgreSQL requieren el procedimiento compatible con Alembic para agregar valores.
- Estas variables deben existir en `.env.example` y tener valores por defecto en `core/config.py`:

  | Variable | Valor por defecto | Uso |
  |---|---:|---|
  | `AUTH_TOKEN_EXPIRE_MINUTES` | `60` | Sesión de socios y administradores |
  | `GUARD_TOKEN_EXPIRE_HOURS` | `168` | Sesión de guardia para trabajo offline |
  | `RESERVA_PENDIENTE_TTL_MINUTES` | `30` | Tiempo tras el cual una pendiente deja de ocupar cupo |

- `PRECIO_BASE_POR_PERSONA` y `PORCENTAJE_DESCUENTO_SOCIO` quedan deprecadas como fuentes dinámicas: pueden usarse únicamente para inicializar datos de seed. Los secretos nunca se guardan en el código.

## 9. Criterios de aceptación del contrato

- [ ] Backend y frontend acuerdan los nombres, formatos y semántica de los modelos documentados.
- [ ] Los schemas Pydantic validan requests y responses; los tipos TypeScript reflejan el mismo contrato.
- [ ] Todo cambio de campo, enum, obligatoriedad o significado se actualiza en ambos lados y en esta documentación en el mismo PR.
- [ ] La API devuelve errores consistentes para los casos especificados: `401` autenticación, `409` duplicados o falta de cupo en el caso descrito, y `422` para datos de reserva inválidos.
- [ ] El cálculo de cotización se implementa una sola vez en el backend y el frontend no recalcula precios.
- [ ] La sincronización procesa ítems individualmente, mantiene idempotencia por `jti` y no descarta la cola por un `401`.
- [ ] Los QR nuevos usan `typ: "reserva"` e incluyen cantidades; los QR legados siguen aceptándose.
- [ ] Las migraciones quedan integradas con un solo head de Alembic.
