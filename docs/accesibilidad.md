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
| Pago aprobado | "Descargar QR" no hace nada | El QR llega por correo y se descarga desde Mis reservas. Conviene quitar el botón o conectarlo |
| Mis reservas | "Ver detalle" de las finalizadas no hace nada | Pantalla de detalle no definida |
| Botón de arrepentimiento | Se revisa cuando se integre la 25.3 | La prueba de axe ya la incluye como pendiente |
| Selector de fecha | El calendario lo dibuja el navegador | Su accesibilidad depende del navegador (WCAG lo permite para controles nativos) |

## Panel de administración (27.3)

Pendiente.

## PWA de acceso (27.4)

Pendiente.
