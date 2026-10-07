# Referencia de la API 

Esta documentación detalla los esquemas de datos, modelos de persistencia relacional y las interfaces HTTP (Endpoints) expuestas por el backend construido sobre FastAPI.

## 1. Modelos de Base de Datos (SQLAlchemy)

El sistema utiliza SQLAlchemy como ORM, mapeando clases Python a tablas en PostgreSQL. Todos los modelos heredan de una base declarativa común (`core.database.Base`).

* **Modelo de Usuario (`User`)**
* **Tabla:** `usuarios`
* **Campos Principales:** ID (`UUID` como identificador único), correo electrónico único, hash de contraseña, DNI.
* **Lógica de Negocio:** Atributo de membresía `is_socio`, estado de cuota y rol del sistema configurado mediante `RoleEnum` (Admin, Seguridad, Cliente).
* **Auditoría:** Marcas de tiempo `created_at` y `updated_at`.
* **Modelo de Reserva (`Reserva`)**
* **Tabla:** `reservas`
* **Campos Principales:** ID (`UUID`), `user_id` (Clave foránea a usuarios), fecha y hora de la reserva, cantidad de personas.
* **Lógica de Negocio:** Estado de pago manejado por `EstadoPagoEnum` (Pendiente, Pagado, Cancelado).
* **Seguridad:** Identificador único para códigos QR (`jwt_jti`).
* **Modelo de Ingresos Físicos (`IngresoFisico`)**
* **Campos Principales:** `reserva_id`, `fecha_hora_ingreso`, `tipo_ingreso` (ej. WEB), `sincronizado_offline` (Booleano que permite métricas analíticas).
* **Modelo de Conflictos de Sincronización (`ConflictosSincronizacion`)**
* **Campos Principales:** ID (`UUID`), `reserva_id` (`UUID`), `jti_involucrado`, `motivo`, `fecha_registro`.
* **Uso:** Tabla de auditoría para derivar reservas que presentan colisiones de concurrencia o duplicidad durante el escaneo offline.


## 2. Esquemas de Validación y Transferencia (Pydantic)

FastAPI utiliza Pydantic para garantizar la serialización y validación estricta de todos los *payloads* de entrada y salida, con mensajes de error normalizados en español.

* **`ReservaCreate` (Payload de Entrada)**
* **Cantidad de personas:** Entero estricto, evaluado entre 1 y la variable de entorno `MAX_PERSONAS_POR_RESERVA` (10).
* **Fechas:** Formato AAAA-MM-DD. El sistema valida que el ingreso no sea anterior a "hoy" (hora de Argentina), el egreso no sea anterior al ingreso y la estadía no supere `MAX_NOCHES_POR_RESERVA` (10).
* **Email:** Validado mediante `EmailStr` empleando la dependencia `email-validator`.
* **Titular:** Cadena de 2 a 100 caracteres, limitando el contenido exclusivamente a letras, espacios, puntos, apóstrofes y guiones (con recorte de espacios en blanco).
* **Teléfono:** Limitado estrictamente a números, requiriendo entre 8 y 15 dígitos.
* **`ReservaResponse` (Payload de Salida)**
* Esquema dedicado al formateo seguro de los datos de la reserva hacia el frontend, omitiendo datos sensibles internos.
* **`JWTPayloadSchema` (Contrato Criptográfico QR)**
* **Campos:** `jti` (UUID del token), `reserva_id` (Entero/UUID), `camping_id` (Entero), `typ` (Clasificación: `socio` o `visitante`), `cantidad_personas` (Entero), `iat` (Issued At), `exp` (Expiration Time) y `dat` (Fecha de la reserva). Este esquema es compartido exactamente con la interfaz `IJwtPayload` de TypeScript.


## 3. Endpoints de Negocio y Reservas

Estos endpoints estructuran la operación principal del sistema de reservas y su seguridad de acceso.

* **`POST /reservas`**
* **Descripción:** Crea una nueva reserva inyectando datos a través de `ReservaCreate`.
* **Manejo de Errores:** Devuelve código HTTP 400 si la petición supera el límite máximo calculado por `capacity_service.py`, o 422 si la validación Pydantic falla (ej. datos mal formados).
* **Lógica Interna:** Acciona el `pricing_service.py` para calcular el costo total automatizado basándose en la cantidad de huéspedes.
* **`GET /reservas/`**
* **Seguridad:** Ruta crítica blindada mediante RBAC y `OAuth2PasswordBearer`.
* **Dependencias:** Exige autenticación válida mediante `get_current_user` y permisos exclusivos autorizados por `require_role` (Administrador).
* **`GET /usuarios/prueba`**
* **Descripción:** Endpoint auxiliar orientado a entornos de desarrollo. Retorna un identificador de usuario válido para agilizar pruebas de creación de reservas.
* **Seguridad:** Queda automáticamente deshabilitado si la variable `ENVIRONMENT` es igual a `production`.


## 4. Endpoints de Sincronización Offline

Rutas operativas que soportan el comportamiento *offline-first* de la Progressive Web App en la barrera de acceso.

### `GET /api/v1/sincronizacion/bootstrap`

* **Tag:** Sincronización Offline.
* **Descripción:** Entrega la configuración inicial y la lista negra paginada requerida para que los dispositivos móviles operen sin internet.
* **Parámetros Query:** `page` (default: 1), `limit` (default: 1000).
* **Respuesta Exitosa (200 OK):**
```json
{
  "blacklist": ["1234", "5678", "9999"],
  "configuracion": {
    "capacidad_maxima": 50,
    "buffer_seguridad": 5
  },
  "clave_publica": "<clave pública de verificación ES256>",
  "pagina_actual": 1,
  "tiene_mas_paginas": false
}

```

(Nota: `blacklist` extrae los identificadores cancelados en las últimas 72 horas).


### `POST /api/v1/ingresos/bulk-sync`

* **Tag:** Ingresos y Sincronización.
* **Seguridad:** Requiere JWT de sesión del guardia administrativo (Header: `Authorization: Bearer <token>`). Emite código 401 si no hay un token válido.
* **Descripción:** Recibe en lote los ingresos registrados por la PWA sin conexión. Procesa el arreglo verificando cada reserva, detectando duplicidades y efectuando un *commit* único.
* **Request Body (`SyncIngresosRequest`):**
```json
{
  "ingresos": [
    { "jti": "abc-123", "reserva_id": 41, "fecha_escaneo": "2026-10-03T14:22:05Z" }
  ]
}

```

* **Respuesta Exitosa (200 OK):**
```json
{
  "procesados": 1,
  "conflictos": 1,
  "sincronizados_jti": ["abc-123", "def-456"],
  "errores": ["Reserva 99 no encontrada en el sistema."]
}

```

* **Manejo de Errores:** Retorna HTTP 500 realizando un *rollback* de todo el lote ante un fallo crítico en la base de datos.


## 5. Endpoints de Pasarela de Pagos

Módulo encargado de la comunicación con los servidores de Mercado Pago (MP) y la acreditación de reservas.

* **`POST /api/payments/create`**
* **Descripción:** Configura el SDK de MP y genera la preferencia de pago.
* **Vínculo:** Inyecta el UUID local de la reserva en el atributo `external_reference` de MP para garantizar trazabilidad. Configura el diccionario `back_urls` (rutas de éxito, fallo, pendiente) y la `notification_url`.
* **`POST /api/payments/webhook`**
* **Descripción:** Ruta de escucha asíncrona para notificaciones de MP.
* **Seguridad y Lógica:** Para prevenir *spoofing*, ignora el contenido del aviso y ejecuta un `payment().get()` contra la API de MP. Si está "approved", actualiza atómicamente la reserva a estado `PAGADO` en PostgreSQL y dispara la emisión del código QR y correo mediante `BackgroundTasks` devolviendo inmediatamente `200 OK` a MP.
* **`GET /api/payments/reconcile/{reserva_id}`**
* **Descripción:** Mecanismo de contingencia para operaciones huérfanas o fallos de webhook.
* **Lógica Interna:** Utiliza el método `.search()` del SDK de MP filtrando por el `external_reference`. Si detecta un pago exitoso omitido localmente, ejecuta la actualización de estado.


## 6. Dominios de Autenticación y Seguridad

FastAPI gestiona dos tipos de llaves criptográficas completamente separadas para evitar exposición sistémica.

* **Sesiones de API (HS256):** El sistema utiliza la variable `AUTH_SECRET_KEY` (criptografía simétrica) para firmar los tokens de los administradores y personal de barrera. Se verifica internamente en el backend.
* **Códigos QR de Acceso (ES256):** El sistema utiliza un par asimétrico de llaves de curva elíptica. El backend emplea la `JWT_PRIVATE_KEY` de manera exclusiva para emitir y firmar las credenciales QR. La `VITE_PUBLIC_KEY` se extrae mediante `/bootstrap` y permite a la aplicación PWA verificar la autenticidad matemática de los QRs sin capacidad de emitir nuevos.