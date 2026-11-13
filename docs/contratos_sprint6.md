# Contratos del Sprint 6 (Día 0)

Acuerdos para trabajar en paralelo durante el Sprint 6. Lo que no está acá sigue igual que en `docs/contratos_sprint5.md` (ramas, PRs, migraciones y archivos que tocan todos).

**Regla de cambios:** este documento solo cambia mediante un PR aprobado por los integrantes afectados.

## 0. Responsables

| Persona | Issue |
|---|---|
| A | 21. Pago publicado y despliegue final |
| B | 22. Cancelación de reservas |
| C | 23. Panel de administración: inicio de sesión por app, personas esperadas y gestión de reservas |
| D | 24. Pruebas de punta a punta y limpieza |

## 1. Archivos compartidos

| Archivo | Quiénes | Acuerdo |
|---|---|---|
| `api/reservas.py` | B, C | B agrega `GET /reservas/{id}/cancelacion` y `POST /reservas/{id}/cancelar`. C amplía `GET /reservas/` y agrega `GET /reservas/{id}`. Integra primero B. Todas las rutas con `{id}` van **después** de `/mias` y `/cotizar`, y reciben el id como `UUID`, para que `/reservas/{id}` no capture otras rutas. |
| `MisReservas.tsx` | bug Descargar QR, B | El bug se integra antes del día 3. B agrega el diálogo en un componente aparte (`DialogoCancelacion.tsx`) y en `MisReservas.tsx` solo lo conecta al botón. |
| `pages/admin/Configuracion.tsx` | B | Solo B la modifica en este sprint (los dos campos de cancelación). |
| `pages/admin/Inicio.tsx` y `pages/admin/routes.tsx` | C | Solo C los modifica en este sprint. |
| `App.tsx`, `Login.tsx` y rutas protegidas | C | Solo C. Las rutas quedan fijas desde el día 1 (ver §3). |
| `seed.py` | A, D | Un solo seed para pruebas y demo (ver §5). D agrega los datos que necesitan las pruebas; A suma los de la demo en una función aparte. |

## 2. Respuestas de los endpoints nuevos

Se fijan antes de programar para que D escriba las pruebas y C y B trabajen con respuestas simuladas mientras tanto.

**`GET /reservas/{id}/cancelacion`** (dueño de la reserva)

```json
{
  "puede_cancelar": true,
  "dias_minimos": 1,
  "fecha_limite": "2026-11-20",
  "porcentaje_devolucion": 100,
  "monto_devolucion": 25000.0,
  "mensaje": null
}
```

Si `puede_cancelar` es `false`, `mensaje` trae el texto que muestra el diálogo.

**`POST /reservas/{id}/cancelar`** (dueño de la reserva): responde `200` con la reserva actualizada (`estado_reserva = CANCELADA`) y `monto_devuelto`. Fuera del plazo, `422` con `detail` igual al mensaje de §4.

**`GET /api/v1/admin/esperados`** (ADMIN)

```json
{ "reservas": 9, "personas": 34 }
```

**`GET /reservas/`** (ADMIN): mantiene `skip`, `limit`, `estado` y `fecha_desde`, y suma `estado_reserva`, `fecha_hasta`, `tipo_cliente` (`socio` | `visitante`) y `busqueda`. Responde `{ "total": 120, "items": [...] }`. Hoy devuelve una lista: el cambio de formato lo hace C junto con la pantalla, y nadie más usa este endpoint.

## 3. Rutas de inicio de sesión (fijas desde el día 1)

| App | Ruta | Después de iniciar sesión |
|---|---|---|
| Web de reservas (socios) | `/login` | `/mis-reservas` |
| Panel | `/admin/login` | `/admin` |
| PWA del guardia | `/acceso/login` | `/acceso` |

## 4. Textos que usan las pruebas

Las pruebas de D buscan estos textos tal cual. Si alguien los cambia, avisa a D en el PR.

| Dónde | Texto |
|---|---|
| Botón en Mis reservas | `Cancelar` |
| Pregunta del diálogo | `¿Está seguro que desea cancelar?` |
| Botón del diálogo | `Confirmar cancelación` |
| Botón para salir del diálogo | `Volver` |
| Fuera de plazo | `Lo sentimos, las reservas solo se pueden cancelar hasta N días antes del ingreso.` |
| Botones de inicio de sesión | `Ingresar` |
| Detalle en Gestión de reservas | `Ver detalle` |

## 5. Datos de prueba

El `seed` deja disponibles, como mínimo:

- `admin@camping.com` y `guardia@camping.com` (contraseña `admin123`), como hoy.
- Un socio con membresía vigente.
- Una reserva pagada de ese socio con ingreso dentro de 10 días (se puede cancelar).
- Una reserva pagada de ese socio con ingreso mañana o hoy (fuera de plazo con la configuración por defecto).
- Una reserva pagada con ingreso hoy y sin escanear (cuenta como esperada).
- Configuración por defecto: buffer 20 %, cancelación hasta 1 día antes y 100 % de devolución.

Las contraseñas del seed son solo para desarrollo y pruebas; en producción no se ejecuta el seed de pruebas.

## 6. Migraciones

Hay una sola migración en el sprint (22.1, persona B), integrada el día 1. Si alguien más necesita una, se avisa en el grupo y se integra después, actualizando `down_revision`.

## 7. Fechas clave

| Día | Qué tiene que estar integrado |
|---|---|
| 1 | Rutas de inicio de sesión (C) y migración de cancelación (B) |
| 2 | Bug de Descargar QR, si todavía no estaba |
| 3 | Endpoints de cancelación (B) |
| 4 a la mañana | Diálogo de cancelación (B), para las pruebas de D |
| 4 a la noche | Se congela `main` |
| 5 | Despliegue final (A) |
