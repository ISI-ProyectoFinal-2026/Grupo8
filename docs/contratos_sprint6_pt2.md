# Qamp — Plan para las issues 25, 26, 27 y la sub-issue 24.5

Las issues están en `claude/issues-arrepentimiento-pwa-accesibilidad.md`. Este plan reemplaza la sección "Convivencia con el sprint en curso" de ese documento: la 24.3 ya está terminada, así que lo que allí se pedía ajustar en la 24.3 pasa a la 25.1.

## Idea general

El trabajo se reparte **por app**, no por issue. Así cada persona es dueña de un grupo de archivos y se puede avanzar en paralelo sin pisarse:

| Línea de trabajo | Qué incluye | Archivos de los que es dueña |
|---|---|---|
| **Backend de cancelación** | 25.1, 25.2 | `services/cancelacion_service.py`, `api/arrepentimiento.py` (nuevo), `services/email_service.py`, `tests/test_cancelacion_reservas.py`, la reserva "fuera de plazo" de `seed.py` y la prueba E2E de cancelación |
| **Web de reservas** | 25.3, 24.5 (web), 27.2 | `components/layout/LayoutPublico`, Header, Footer, `pages/` de la web, `pages/Arrepentimiento.tsx` y `pages/CancelarReserva.tsx` (nuevos) |
| **PWA de acceso** | 26.1 a 26.4, 24.5 (PWA), 27.4 | `LayoutAcceso.tsx`, `ControlAcceso.tsx`, `db/db.ts`, `services/dbService.ts`, `services/syncService.ts`, páginas nuevas de la PWA, prueba E2E 24.2 |
| **Panel** | 26.5, 26.6, 24.5 (panel), 27.3 | `pages/admin/*`, `components/admin/*`, `api/admin_ingresos.py` (nuevo) |
| **Base común y verificación** | Estilo común de la 24.5, 27.1, revisión final de la 27 | `index.css` / configuración de Tailwind, `index.html`, lint, configuración de Playwright, `docs/accesibilidad.md` |

**Qué permite el paralelismo:**

- La 25 es casi toda backend; su pantalla (25.3) se arma con respuestas simuladas desde el día 1 gracias a los contratos de abajo.
- La 24.5 y la 27 no se hacen "al final sobre todo": cada dueño aplica el estilo nuevo y las pautas de accesibilidad en **sus** pantallas mientras las construye. La base común (colores, tipografía, foco visible) se fija el día 1 y ya con el contraste verificado, así la 24.5 y la 27.x no se contradicen.
- Ninguna línea necesita migración. La única "base de datos" que cambia es la local de la PWA (`db.ts` versión 4), y es de una sola línea de trabajo.

## Reparto sugerido

| Persona | Línea | Por qué |
|---|---|---|
| B | Backend de cancelación (25.1, 25.2) y después ayuda con la 25.3 | Hizo la Issue 22 y conoce `cancelacion_service.py` |
| A | PWA de acceso (26.1 a 26.4, 24.5 y 27.4 de la PWA) | Es la línea más larga; A tuvo tiempo libre en el sprint 6 |
| C | Panel (26.5, 26.6, 24.5 y 27.3 del panel) | Ya es dueño de `Inicio.tsx` y `routes.tsx`. Arranca cuando cierre la 23.4 y la 23.5 |
| D | Base común, web de reservas (24.5 y 27.2 de la web, 25.3) y verificación (27.1) | Tenía la 24.5 y armó las pruebas E2E, que es donde se suma axe |

Si C sigue con la 23.4 y la 23.5 más de un día, D toma la 26.5, que es chica.

---

## Día 0 — Acuerdos antes de programar (una hora, todos)

Agregar a `contratos_sprint6.md` (o a un `contratos_sprint7.md`):

1. **Rutas fijas** (las agrega D en `App.tsx` el día 1 con pantallas vacías, como se hizo en la 15.1; después nadie más toca `App.tsx`):
   - Web: `/arrepentimiento` y `/cancelar-reserva`.
   - PWA: `/acceso`, `/acceso/manual`, `/acceso/historial`, `/acceso/sincronizacion`.
   - Panel: `historial-ingresos` (en `routes.tsx`, la agrega C).
2. **Respuestas de los endpoints nuevos:**

   `POST /arrepentimiento/solicitud` con `{ "email": "..." }` → `202`
   ```json
   { "mensaje": "Si hay reservas con ese email, te enviamos un correo con un enlace para cada una." }
   ```
   `GET /arrepentimiento/condiciones?token=...` → igual que `GET /reservas/{id}/cancelacion`, más `"arrepentimiento": true | false`. Token inválido o vencido → `401` con `detail`.

   `POST /arrepentimiento/confirmar` con `{ "token": "..." }` → igual que `POST /reservas/{id}/cancelar`, más `"codigo_gestion"`.

   `GET /api/v1/admin/ingresos?desde=&hasta=&skip=&limit=` (ADMIN) →
   ```json
   { "total": 120, "items": [ { "fecha_hora": "...", "reserva_id": "... o null", "cantidad_personas": 3, "tipo_cliente": "socio | visitante | null", "tipo_ingreso": "WEB | MANUAL" } ] }
   ```
3. **Textos que usan las pruebas** (se suman a los de §4 de los contratos): `Botón de arrepentimiento`, `Enviar enlace`, `Online`, `Offline`, `Sincronizar ahora`, `Historial`, `Registro manual`, `Estado de sincronización`, `Historial de ingresos`. La 24.5 puede cambiar el aspecto, pero no estos textos.
4. **Paleta y tipografía de la 24.5** (las propone D, con la paleta verde de los mockups y el estilo del Figma): cada par de colores de texto y fondo se aprueba solo si tiene contraste de al menos 4,5:1. Esto es lo que evita que la 27 obligue a rehacer la 24.5.

---

## Plan de 5 días

| Día | B — Backend de cancelación | A — PWA | C — Panel | D — Base, web y verificación |
|---|---|---|---|---|
| 1 | 25.1: regla de arrepentimiento + ajuste de tests "fuera de plazo", del seed y de la prueba E2E de cancelación | 26.1 indicador de conexión, ya con el estilo nuevo | 23.4 / 23.5 | Estilo común de la 24.5 (colores, tipografía, foco visible) + rutas vacías en `App.tsx` + `lang="es"` y títulos (27.1) |
| 2 | 25.2: solicitud, token y correos | 26.2 historial local (`db.ts` v4) | 23.4 / 23.5 (cierre) → 26.5 banner y menú | 24.5 web: Home, Reservas, Mis reservas, Header y Footer (con el enlace "Botón de arrepentimiento") |
| 3 | 25.2 (cierre) + enlace en el correo del QR | 26.3 estado de sincronización | 26.6 historial de ingresos: backend | 25.3 pantallas de arrepentimiento con respuestas simuladas |
| 4 | Ayuda a D a conectar la 25.3 con el backend real + prueba E2E del visitante que cancela | 26.4 barra inferior, registro manual propio + actualizar la prueba 24.2 | 26.6 pantalla + 24.5 del panel (inicio, Gestión de reservas) | 27.1: axe en las pruebas E2E y `eslint-plugin-jsx-a11y` en el CI |
| 5 | Revisión de PRs + prueba manual del botón de arrepentimiento | 27.4 en la PWA según lo que marque axe | 27.3 en el panel según lo que marque axe | 27.2 en la web + `docs/accesibilidad.md` + corrida completa de E2E |

**Reglas**

1. Un PR por día por persona, como mínimo, revisado el mismo día.
2. Las pantallas nuevas se hacen directamente con el estilo de la 24.5 y con etiquetas, roles y foco correctos. Así la 24.5 y la 27 no son una pasada extra.
3. Nadie cambia los textos acordados del día 0 sin avisar en el PR.
4. Si algo se atrasa, se recorta en este orden: primero 24.5 del panel, después 24.5 de la web, después 26.3. **La 25 no se recorta** porque es un requisito legal, y la 27.1 tampoco, porque es la que demuestra el cumplimiento.

---

## Dependencias entre líneas

| Quién espera | Qué necesita | De quién | Cuándo |
|---|---|---|---|
| D (25.3) | Contratos de la API de arrepentimiento | Día 0 | Día 3, con respuestas simuladas |
| D (25.3 conectada) | 25.1 y 25.2 integradas | B | Día 4 |
| A, B, C | Estilo común de la 24.5 | D | Fin del día 1 |
| A (26.4) y C (26.6) | Rutas vacías en `App.tsx` y `routes.tsx` | D y C | Día 1 |
| D (27.1, día 4) | Pantallas nuevas integradas para correr axe | A, B, C | Día 4 a la noche |
| C (26.6 pantalla) | Endpoint de ingresos | C mismo | Día 3 |

## Archivos compartidos

| Archivo | Quiénes | Acuerdo |
|---|---|---|
| `App.tsx` | D | D agrega todas las rutas el día 1; nadie más lo toca. |
| `seed.py` | B, C | B corrige la reserva "fuera de plazo" (ingreso hoy y `fecha_reserva` de hace 11 días). C suma ingresos de ejemplo para el historial del panel, en una función aparte. |
| Pruebas E2E | B, A, D | B ajusta la de cancelación (24.3) si cambian sus datos, A la de corte de internet (24.2) por la barra inferior, D agrega axe sin cambiar los pasos. |
| `index.css` / Tailwind | D | Solo D cambia el estilo común; los demás piden cambios en el PR de D. |
| `.env.example` | B | Suma `ARREPENTIMIENTO_SECRET_KEY` y `ARREPENTIMIENTO_TOKEN_MINUTOS`. |

## Riesgos

- **La 25.1 rompe tests existentes a propósito:** los "fuera de plazo" del backend y la prueba E2E de cancelación (24.3) usan reservas recién hechas, que con la regla nueva sí se pueden cancelar. Se corrigen en el mismo PR de la 25.1 (reserva con `fecha_reserva` de hace 11 días y, en el seed, ingreso hoy).
- **Axe puede marcar muchas cosas el día 4:** por eso la base común (contraste y foco) se fija el día 1 y las pantallas nuevas ya se hacen accesibles. Lo que quede sin resolver se anota en `docs/accesibilidad.md`, como pide la 27.
- **La 23.4 y la 23.5 no están detalladas en los documentos:** si se estiran, D toma la 26.5 y C arranca directo con la 26.6.
- **Revisión legal de la 25:** conviene mostrarle la regla al docente antes del día 3, cuando se cierra la 25.2.
- **Cantidad de días:** el plan supone 5 días de trabajo. Si hay menos, ver el orden de recorte de arriba.
