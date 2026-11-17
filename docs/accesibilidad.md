# Accesibilidad (Issue 27)

Objetivo: las tres apps cumplen WCAG 2.2 nivel AA. Cumplir la 2.2 implica cumplir la 2.0 y la 2.1, que es la versión que toma la normativa argentina (Ley 26.653).

Cómo se verifica (detalle en `docs/testing_guide.md`, sección 3.6):

- **jsx-a11y** revisa el código en cada PR (`npm run lint:a11y`).
- **axe** revisa las pantallas dibujadas en las pruebas E2E (`e2e/accesibilidad.spec.ts`) y falla con problemas graves o críticos.
- Pruebas de teclado en Playwright y de componente en Vitest para lo que axe no puede ver (foco, orden, diálogos).

Este documento anota qué se hizo en cada app y las diferencias con WCAG 2.2 AA que quedan.

---

## Base común (27.1)

| Pauta | Cómo se cumple |
|---|---|
| 3.1.1 Idioma de la página | `index.html` con `lang="es-AR"` |
| 2.4.2 Página titulada | Cada pantalla cambia el título de la pestaña (`src/lib/titulos.ts`, aplicado por `TituloDePagina`) |
| 2.4.7 Foco visible | Contorno de 2 px en el verde de acción para todo lo que se usa con teclado (`index.css`) |

## Web de reservas (27.2)

| Pauta | Cómo se cumple |
|---|---|
| 1.3.1 y 3.3.2 Etiquetas | Cada campo tiene su etiqueta visible asociada con `htmlFor`. El email de contacto tenía solo `aria-label`: ahora tiene etiqueta visible |
| 3.3.1 Identificación de errores | Cada error aparece debajo de su campo, se anuncia (`role="alert"`) y el campo lo tiene como descripción (`aria-describedby`) y se marca con `aria-invalid`. Lo resuelven `ErrorDeCampo` y `atributosDeError` (`lib/errorDeCampo.ts`) |
| 3.3.1 / 4.1.3 Mensajes de estado | Los errores al guardar la reserva y el resultado de "Verificar pago" se muestran en la pantalla. Antes usaban `alert()` del navegador |
| 2.4.3 Orden del foco | Al enviar con errores, el foco va al primer campo con error. Al cambiar de pantalla, el foco pasa al contenido nuevo (`LayoutPublico`) |
| 2.4.1 Evitar bloques | Enlace "Saltar al contenido" como primer elemento de cada pantalla |
| 2.4.3 Diálogos | El diálogo de cancelación mantiene el foco adentro (Radix) y al cerrarlo lo devuelve al botón "Cancelar". Si la reserva se canceló, el foco va al mensaje con el resultado, porque el botón ya no existe |
| 2.4.6 / 1.3.1 Títulos | Las pantallas de pago y de disponibilidad no tenían `h1`: el título de la tarjeta ahora lo es |
| 4.1.2 Nombre, función y valor | Los enlaces con forma de botón eran un `<a>` con un `<button>` adentro (dos elementos que se enfocan). Ahora son un solo enlace (`Button asChild`) |
| 1.4.1 Uso del color | Los estados de Mis reservas tienen texto e ícono propio, no solo color |
| 1.4.3 Contraste del texto | En Beneficios, los títulos de las tarjetas oscuras heredaban el marrón del texto general (1,2:1): ahora van en blanco (14:1). Errores en `text-destructive` (6,6:1 sobre blanco, 4,9:1 sobre el fondo) en lugar de `text-red-600`, que daba 3,6:1 sobre el fondo. Botón de Mercado Pago en #0076B4 (4,9:1) |
| 1.4.11 Contraste de componentes | El borde de los campos pasó de #D7CFC6 (1,5:1) a #8C8075 (3,9:1). Afecta a las tres apps |
| 2.4.7 Foco visible en menús | Las opciones de los menús desplegables y de las listas de selección tenían un fondo casi igual al blanco al enfocarse. Ahora también tienen el anillo de foco |

### Diferencias que quedan

| Pantalla | Diferencia | Motivo |
|---|---|---|
| Contacto | El formulario no envía nada (muestra un `alert()`) y usa la validación del navegador | Es una pantalla de demostración. Cuando se conecte a un servicio real, debe usar `ErrorDeCampo` como las demás |
| Mis reservas | "Ver detalle" de las finalizadas no hace nada | Pantalla de detalle no definida |
| Cancelar reserva (`/cancelar-reserva`) | La prueba de axe no la recorre | Necesita un enlace válido del correo. La recorre la prueba E2E del botón de arrepentimiento (25.3); `/arrepentimiento` sí está en la prueba de axe |
| Selector de fecha | El calendario lo dibuja el navegador | Su accesibilidad depende del navegador (WCAG lo permite para controles nativos) |

## Panel de administración (27.3)

| Pauta | Cómo se cumple |
|---|---|
| 1.3.1 Tablas | Gestión de reservas, Socios, Descuentos, Tipos de reserva y las personas del detalle tienen `<caption>` (oculto a la vista), encabezados de columna con `scope="col"` y la primera celda de cada fila como encabezado de fila (`scope="row"`). Resumen de cobros ya cumplía |
| 1.3.1 y 3.3.2 Filtros | Todos los filtros tienen etiqueta visible. El error de fechas de Gestión de reservas queda asociado al campo "Ingreso hasta" |
| 3.3.1 Errores | Los formularios de socios, descuentos, tipos de reserva, configuración y renovación usan `ErrorDeCampo` y `atributosDeError`, como la web. Si el campo tiene texto de ayuda, se lee la ayuda y después el error |
| 1.3.1 / 1.4.1 Ocupación | La barra tiene `role="progressbar"` con `aria-valuenow`, `aria-valuemax` y `aria-valuetext`, y el valor, el porcentaje y el nivel también están en texto ("Ocupación alta") |
| 2.4.3 Ventanas emergentes | El diálogo común (`components/ui/dialog.tsx`) devuelve el foco al botón que lo abrió aunque no sea un `DialogTrigger`. Antes, al cerrar "Ver detalle" el foco se perdía. Lo aprovechan también la web y la PWA |
| 2.4.3 Formularios dentro de la pantalla | Al abrir "Nuevo", "Editar" o "Renovar", el foco va al primer campo del formulario. Al cancelar, vuelve al botón que lo abrió. Al guardar, va al aviso con el resultado (`hooks/useFocoDeFormulario.ts`) |
| 2.4.3 Confirmaciones en la fila | "Dar de baja" (socios) y "Resolver incidente" (alertas) llevan el foco a la confirmación y, si se cancela, lo devuelven al botón |
| 2.4.1 Evitar bloques | "Saltar al contenido" deja atrás el menú lateral. Al cambiar de sección, el foco pasa al contenido |
| 2.4.7 Foco visible | En la barra lateral el contorno de foco es blanco: el verde común no se veía sobre el verde oscuro. Los selectores nativos de los filtros pasan de un anillo de 1 px a uno de 2 px |
| 1.4.3 Contraste | `text-zinc-500` pasa a `text-zinc-600` (de 3,6:1 a 5,7:1 sobre el fondo) y los errores a `text-destructive`. En Alertas, los grises y rojos sueltos (#666, #a94442) no llegaban a 4,5:1 |

### Diferencias que quedan

| Pantalla | Diferencia | Motivo |
|---|---|---|
| Historial de ingresos | Se revisa cuando se integre la 26.6 | La pantalla todavía no existe; la prueba de axe ya la incluye como pendiente. Su tabla tiene que seguir el mismo patrón (caption, `scope`) |
| Egresos | No tiene tabla | La issue nombra una tabla de egresos, pero la pantalla solo registra egresos y no los lista |
| Alertas e Incidentes | Siguen con estilos sueltos, sin el estilo común de la 24.5 | Se corrigió el contraste y el foco. El aspecto queda para la 24.5 del panel y la 26.5 (unifica Incidentes y Alertas) |

## PWA de acceso (27.4)

La PWA se usa al aire libre y con apuro: además de WCAG, mantiene los botones grandes y el alto contraste de la 24.5. Buena parte ya venía resuelta de la 26.1 a la 26.4; esta sub-issue la verificó y completó lo que faltaba.

| Pauta | Cómo se cumple |
|---|---|
| 4.1.3 Resultado del escaneo | Se anuncia con `role="alert"` y combina color (borde verde o rojo), ícono (tilde o cruz) y texto ("INGRESO CONFIRMADO", "Acceso Denegado…", "Reserva Cancelada / Acceso Revocado") |
| 4.1.3 Conexión y pendientes | La barra superior anuncia "Online"/"Offline" y el contador de pendientes en dos regiones `role="status"` separadas, así cada escaneo solo anuncia el contador (26.1). El aviso "Sincronizando…" del escáner ya no se anuncia, porque lo repetía; sí se anuncian el resultado y los errores |
| 2.5.8 Tamaño de los objetivos | Mínimo 24 × 24 px. En la práctica, los botones de la PWA miden 48 px o más de alto (Escanear 64 px, barra inferior 56 px) |
| 1.4.3 Contraste | Revisado con los colores de la 24.5: el texto más bajo es el gris secundario sobre el fondo claro de los datos (6,2:1). El blanco sobre la barra superior da 10,5:1 |
| 1.3.1 y 3.3.2 Etiquetas | El campo del token tenía solo `aria-label` y texto de ejemplo: ahora tiene la etiqueta visible "Token del QR" |
| 2.4.3 Foco en el escáner | Al abrir el escáner, el foco va a la indicación "Apunte al código del visitante" y no al campo del token, para que en el celular no aparezca el teclado tapando la cámara. Al leer un código o cancelar, vuelve a "Escanear QR", listo para el próximo visitante |
| 2.4.3 Cambio de pantalla | Al tocar una opción de la barra inferior, el foco pasa a la pantalla nueva. La barra marca la actual con `aria-current="page"` |
| 2.3.3 Movimiento | Los íconos que giran mientras se sincroniza respetan "reducir movimiento" del sistema (`motion-safe`). Es nivel AAA; se hizo porque no tenía costo |

### Diferencias que quedan

| Pantalla | Diferencia | Motivo |
|---|---|---|
| Escáner | El número de lugares libres ("57 / 100") es un `h2` | Lo usa la prueba E2E de cancelación para leer la capacidad. Conviene pasarlo a texto común y cambiar esa prueba en una issue aparte |
| Escáner | La vista de la cámara la dibuja `html5-qrcode` | No se controla su marcado; el campo del token es la alternativa accesible y siempre está visible |
| Escáner | No hay "Saltar al contenido" | La barra superior no tiene nada que se use con Tab, así que no hay bloque que saltar |
