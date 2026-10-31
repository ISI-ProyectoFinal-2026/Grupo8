# Contratos del Sprint 5 (Día 0)

Acuerdos para trabajar en paralelo durante el Sprint 5: quién es dueño de cada archivo, qué archivos se comparten y cómo se integran los cambios.

**Regla de cambios:** este documento solo cambia mediante un PR aprobado por los integrantes afectados. Si el código y este documento difieren, el PR que introduce la diferencia actualiza también el documento.

## 0. Issues y responsables

| Responsable | Issue | Tema |
|---|---|---|
| P1 | 17 | Pagos de Mercado Pago: registro, seguridad y plazo de pago |
| P2 | 18 | Ocupación real, egresos y monitor del panel |
| P3 | 19 | Configuración del camping y tipos de reserva |
| P4 | 20 | Socios y membresías desde el panel |

## 1. Archivos de cada integrante

Cada integrante modifica libremente sus archivos. Para cambiar un archivo de otro, se le avisa al dueño o se le pide que haga el cambio.

| Responsable | Backend | Frontend |
|---|---|---|
| P1 | `api/payments.py`, `services/payment_service.py`, `services/email_service.py`, modelo `pagos` | `PagoExito.tsx`, `PagoPendiente.tsx`, `PagoRechazado.tsx`, `MisReservas.tsx`, componente de cuenta regresiva |
| P2 | `api/ingresos.py`, modelo y endpoint de egresos, servicio de ocupación, endpoint de cobros | `syncService.ts`, `pages/admin/Inicio.tsx`, `pages/admin/Ocupacion.tsx` |
| P3 | `models/configuracion.py`, modelo `tipos_reserva`, `services/pricing_service.py`, `schemas/reserva.py`, endpoints de configuración y tipos | `Home.tsx`, `Disponibilidad.tsx`, `Reservas.tsx`, pantallas Configuración y Tipos de reserva del panel |
| P4 | `api/admin_socios.py`, `api/socios.py`, `services/socio_service.py`, `services/alta_socio_service.py`, `services/auth_service.py` (bloqueo de socios dados de baja), `models/user.py` | `pages/admin/Socios.tsx` |

Los tests de cada archivo pertenecen al dueño del archivo.

## 2. Archivos compartidos entre dos integrantes

Antes de modificar uno de estos archivos, avisar en el grupo. Integra primero quien figura primero.

| Archivo | Quiénes | Qué hace cada uno | Orden |
|---|---|---|---|
| `services/capacity_service.py` | P1, P3 | P1: plazo de 10 minutos. P3: unidades por tipo de reserva | P1 → P3 |
| `api/reservas.py` | P1, P3 | P1: devolver el vencimiento del plazo. P3: recibir el tipo de reserva | P1 → P3 |
| `Reservas.tsx` | P1, P3 | P1: cuenta regresiva en un componente aparte. P3: formulario según el tipo, que importa ese componente | P1 → P3 |
| `api/sincronizacion.py` | P3, P4 | P3: configuración desde la base. P4: lista real de reservas canceladas | P4 → P3 |

## 3. Archivos que tocan todos

Solo se agrega lo propio. No se reordena, no se reformatea y no se borra lo de otros.

| Archivo | Qué se agrega |
|---|---|
| `main.py` | Una línea por router nuevo |
| `core/config.py` y `.env.example` | Las variables nuevas, al final y con un comentario corto |
| `models/__init__.py` | Una línea por modelo nuevo |
| `pages/admin/routes.tsx` | Una entrada por pantalla nueva |
| `seed.py` | Los datos iniciales propios, en una función aparte |

## 4. Migraciones

- Cada integrante crea su migración sin esperar a los demás.
- Orden de integración: **P1 (`pagos`) → P2 (`egresos_fisicos`) → P3 (configuración y `tipos_reserva`) → P4 (socios)**.
- Al integrar, actualizar `down_revision` al head vigente de `main`. `alembic heads` debe mostrar una sola línea antes de abrir el PR.
- Una migración por PR, con `downgrade()` y los datos iniciales necesarios para las filas existentes.
- El procedimiento está en `docs/guia_migraciones.md`.

## 5. Ramas y pull requests

1. Una rama por sub-issue, creada desde `main` actualizado.
2. Un PR por sub-issue. PRs chicos se revisan e integran más rápido.
3. Antes de abrir el PR: traer los cambios de `main`, resolver conflictos y correr los tests de backend y frontend.
4. Si un PR cambia algo que usa otro integrante (un endpoint, un campo, un tipo), se lo menciona en la descripción y se espera su aprobación.

## 6. Decisiones del Sprint 5

| ID | Decisión |
|---|---|
| S1 | Las claves por camping (F05) quedan fuera del MVP. Se mantiene un solo camping y una sola clave para los QR. |
| S2 | Una reserva sin pagar tiene 10 minutos para pagarse (`RESERVA_PENDIENTE_TTL_MINUTES = 10`). Pasado ese plazo libera el cupo, el link de Mercado Pago vence y el usuario ve una cuenta regresiva. |
| S3 | Los tipos de reserva se administran desde el panel: nombre, precio, forma de cobro (por persona o por unidad), máximo de personas, cantidad de unidades y activo. |
| S4 | Un tipo por unidad (cabaña) pide solo los datos del titular y la cantidad de personas, cobra un precio fijo por unidad y no supera las unidades disponibles. |
| S5 | El máximo de personas por reserva, la capacidad y el buffer se leen de `configuracion_camping`, no de `settings`. |
| S6 | El backend sigue siendo la única fuente de precios. El frontend no tiene precios ni tipos escritos a mano. |
| S7 | **Reemplaza D3 del Sprint 4.** La preferencia de Mercado Pago se crea con `expires: true` y `expiration_date_to` igual al vencimiento de la reserva (10 minutos). Se excluyen los pagos en efectivo (`excluded_payment_types`: `ticket` y `atm`), que se acreditan tarde. |
| S8 | Si igual llega un pago aprobado de una reserva vencida (por ejemplo, una tarjeta que quedó en revisión): con cupo, se confirma la reserva; sin cupo, se devuelve el dinero con la API de reembolsos de Mercado Pago y se avisa al titular por correo. En los dos casos el pago queda registrado en `pagos`. |
| S9 | La cabaña (cobro por unidad) se cobra por noche: noches = egreso − ingreso. |
| S10 | Un socio dado de baja no puede iniciar sesión. |
| S11 | Desde el panel se definen el cupo máximo, el porcentaje de buffer offline y el máximo de personas por reserva. El buffer es la parte del cupo que no se vende online y queda para los ingresos que el guardia registra en la puerta, aunque no haya internet. Se guarda como porcentaje, con 10 % recomendado por defecto. |
| S12 | Los colores del monitor de ocupación los define quien lo implementa. |

## 7. Pendiente de confirmar antes de empezar

- **Días en los tipos por persona (D2 del Sprint 4):** D2 cobra por días (egreso − ingreso + 1), pero en la 14.3 el precio por persona quedó sin días. Hay que definir si los tipos por persona se cobran por día, por noche o una sola vez.

## 8. Criterios de aceptación del contrato

- [ ] Cada integrante conoce sus archivos y los compartidos.
- [ ] Los puntos de §7 quedan decididos y anotados en §6.
- [ ] Al final del sprint, `alembic heads` muestra un solo head.
- [ ] Ningún PR deja secretos ni direcciones fijas en el código.
- [ ] Los tests de backend y frontend pasan en `main` después de cada integración.
