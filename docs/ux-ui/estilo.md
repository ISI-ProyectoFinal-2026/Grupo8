# Estilo común de Qamp (Sub-issue 24.5)

Reemplaza la paleta de la sección 3.1 del `readme.md` de esta carpeta. Toma la estructura de los mockups y, del estilo de referencia, el fondo degradado, la tipografía y el color del texto. **El verde salvia (#BBDBBC) ya no se usa.**

Todo está definido en `frontend/pwa-acceso/src/index.css` (variables) y `tailwind.config.js` (escalas `tierra` y `bosque`). Para cambiar un color se cambia ahí; las pantallas no usan colores sueltos.

## Colores

| Nombre | Hex | Clase | Uso |
|---|---|---|---|
| Fondo arriba → abajo | #E4DDD5 → #F7F6F4 | (en `body`, fijo al alto de la pantalla) | Fondo de las tres apps |
| Texto principal | #3F3730 | `text-foreground` (`tierra-800`) | Títulos y textos |
| Texto secundario | #655B52 | `text-muted-foreground` (`tierra-500`) | Descripciones y etiquetas |
| Verde de acción | #1F5C26 | `bg-primary` (`bosque-600`) | Botones principales y pestaña activa |
| Verde al pasar el mouse | #184B1E | `bosque-700` | Hover de los botones principales |
| Gris de botones | #E8E3DD | `bg-secondary` (`tierra-200`) | Botones secundarios (reemplaza al salvia) |
| Verde oscuro | #233826 | `bg-lateral` | Barra lateral del panel y barra superior de la app del guardia |
| Bordes | #E8E3DD / #D7CFC6 | `border` / `border-input` | Tarjetas / campos |
| Error | #B42318 | `text-destructive` | Mensajes de error y "Cerrar sesión" |

## Contraste verificado (mínimo 4,5:1)

| Texto | Fondo | Contraste |
|---|---|---|
| Texto principal | Fondo arriba (#E4DDD5) | 8,7:1 |
| Texto principal | Tarjeta blanca | 11,7:1 |
| Texto secundario | Fondo arriba | 4,9:1 |
| Texto secundario | Tarjeta blanca | 6,6:1 |
| Texto secundario | `tierra-100` (pestañas inactivas) | 5,8:1 |
| Blanco | Verde de acción | 8,0:1 |
| Verde de acción | Blanco | 8,0:1 |
| Texto `tierra-900` | Gris de botones | 11,4:1 |
| Blanco | Barra lateral | 12,6:1 |
| Texto del menú (`tierra-200`) | Barra lateral | 9,9:1 |
| Error | Blanco / fondo arriba | 6,6:1 / 4,9:1 |
| Anillo de foco (verde de acción) | Fondo arriba | 6,0:1 (se pide 3:1) |

`tierra-300` y `tierra-400` no tienen contraste suficiente sobre fondos claros: solo se usan para bordes e íconos decorativos, nunca para texto.

## Tipografía y formas

- En pantallas de 1024 px o más, todo se ve al 90 % (`font-size: 90%` en `html`), para que los formularios entren sin desplazarse. En el celular se mantiene el tamaño completo.
- **Poppins** 400, 500, 600 y 700, instalada con `@fontsource/poppins` (funciona sin conexión).
- Títulos grandes en 600, con poco espacio entre letras (`tracking-tight`).
- Botones, pestañas y etiquetas de estado en forma de píldora (`rounded-full`); tarjetas con `rounded-3xl`; campos con `rounded-xl` y 44 px de alto.
- **Foco visible:** contorno de 2 px en el verde de acción en todo lo que se usa con teclado.

## Componentes comunes

- `.fondo-montanas`: montañas dibujadas al pie de la pantalla, fijas (siempre a la vista). Va antes del contenido, con `aria-hidden="true"`; el contenido que va encima necesita `position: relative`.
- `components/marca/LogoQamp.tsx`: logo del panel y de la app del guardia (una carpa dentro de una Q). Toma el color del texto.
- `components/ui/tabs.tsx`: pestañas en píldora; la activa en verde de acción.
- La web de reservas muestra el nombre y los datos del camping desde el `.env` (`VITE_CAMPING_*`, ver `frontend/pwa-acceso/.env.example`), nunca "Qamp".

## Pautas por app

**Web de reservas (D):** encabezado sin color, igual al fondo; la pestaña actual del menú en píldora blanca; el pie con los datos del camping y el enlace "Botón de arrepentimiento".

**Panel (aplicado en `AdminLayout.tsx`):**
- Fondo común, sin tonos más oscuros; barra superior sin color.
- Barra lateral en `bg-lateral`, con el logo en blanco; la sección activa en píldora blanca con texto `text-lateral`.
- Las secciones con `alPie: true` en `routes.tsx` (hoy, Configuración) van abajo de todo, justo encima de "Cerrar sesión".

**App del guardia (aplicado en `LayoutAcceso.tsx` y `ControlAcceso.tsx`):**
- Misma estética que el panel: barra superior en `bg-lateral` y el fondo común.
- Barra superior: menú ☰ (con el estado de sincronización y "Cerrar sesión"), título de la pantalla e indicador "Online"/"Offline" con ícono y texto.
- Barra inferior blanca con Historial (`/acceso/historial`, vacía hasta la 26.2), Escáner (`/acceso`, al medio) y Registro manual (`/acceso/manual`); la 26.4 suma Estado de sincronización. El registro manual se abre solo desde la barra.
- Botones secundarios en el gris de botones (`variant="secondary"`); la pestaña activa de la barra inferior (26.4) también.
- Botones de al menos 56 px de alto y alto contraste. Sin emojis: íconos de `lucide-react` con `aria-hidden`.
- El resultado del escaneo combina color, ícono y texto, y se anuncia con `role="alert"`.
- Los textos acordados en los contratos no cambian.
