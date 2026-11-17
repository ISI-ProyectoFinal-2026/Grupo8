# Qamp - Documentación

Esta documentación está estructurada bajo el modelo *Docs as Code* para acompañar el desarrollo híbrido (B2B2C) de nuestro proyecto, constituído por tres módulos principales: una plataforma de reservas, una aplicación PWA orientada al control de accesos y un dashboard administrativo.

## Índice de Contenidos

### 1. [Guía de Usuario](./user_guide.md)
Manual operativo del software. Cubre:
- El ciclo de vida de una reserva y la emisión del código QR.
- Cómo los guardias deben operar la aplicación móvil (PWA) sin conexión a internet.
- Navegación del cliente en el buscador, pasarela de pagos (con el plazo de 10 minutos para pagar) y autogestión de perfil.
- Cancelación desde Mis reservas y "Botón de arrepentimiento" sin cuenta.
- Uso del panel de administración: monitor de ocupación, personas esperadas, gestión de reservas, egresos y resumen de cobros.

### 2. [Documentación Técnica](./technical_documentation.md)
Arquitectura y decisiones de diseño interno:
- **Backend:** FastAPI, PostgreSQL, SQLAlchemy y migraciones con Alembic.
- **Frontend:** React, Vite y arquitecturas de interfaz con Shadcn UI; un inicio de sesión por app, rutas por rol, estructura del panel de administración y estilo común de las tres apps.
- **Seguridad Offline:** Criptografía asimétrica (ES256), IndexedDB, Dexie.js y el motor de validación local mediante la *Web Crypto API*.
- **Comunicaciones:** Orquestación asíncrona para la generación de correos electrónicos y códigos QR en memoria RAM (Resend + Jinja2).
- **Sesiones y permisos:** inicio de sesión con DNI o correo, roles, protección de rutas, sesión del guardia sin conexión y alta de socios.
- **Socios y clonación:** baja lógica y regla única de vigencia; detección de QR clonados y resolución de alertas.
- **Pagos:** registro de cada pago de Mercado Pago, firma de los avisos, control del importe y plazo de pago de 10 minutos con reembolso de los pagos tardíos.
- **Cancelaciones:** reglas del camping, plazo de arrepentimiento (Ley 24.240 y Disposición 954/2025) y enlaces firmados por correo para cancelar sin cuenta.
- Complementos: [Bootstrap de la PWA y lista negra](./pwa-bootstrap-y-blacklist.md) y [Manejo de zonas horarias](./zonas-horarias.md).

### 3. [Guía de Pruebas (Testing)](./testing_guide.md)
Instrucciones para mantener la calidad del software:
- Ejecución de suites con `pytest` (Backend) y `vitest` (Frontend).
- Pruebas del motor criptográfico y manipulación de JWT.
- Entornos de simulación de caídas de red y configuración de `ngrok` para testing de hardware (cámara) en móviles.
- Pruebas de punta a punta con Playwright en un solo comando (`npm run test:e2e`).

### 4. [Referencia de la API](./api_reference.md)
Definición estricta de contratos de datos y endpoints:
- Modelos principales (Usuarios, Reservas, Configuraciones).
- Motor de reglas, cálculo dinámico de tarifas y validaciones de cupos.
- Endpoints de sincronización transaccional (`/bootstrap`, `/bulk-sync`) y webhooks financieros (Mercado Pago).
- Endpoints del panel: ocupación, personas esperadas, gestión de reservas, egresos y resumen de cobros.
- Inicio de sesión (`/auth/login`, `/auth/me`), token de sesión y permisos por rol.
- Socios y membresías (padrón, renovación y baja) y alertas de clonación.
- Cancelación de reservas y botón de arrepentimiento.

### 5. [Guía de Despliegue (Deployment)](./deployment.md)
Cómo llevar la plataforma a entornos de producción:
- Integración y despliegue continuo (CI/CD) automatizado en GitHub Actions.
- Infraestructura Frontend hospedada en Vercel.
- Infraestructura Backend hospedada en Render y base de datos PostgreSQL en Neon.
- Configuración de Mercado Pago (credenciales de prueba, webhook y retorno automático) y de Resend.
- Checklist y problemas encontrados en la prueba del pago con el sandbox en el entorno publicado.
- Gestión estricta de secretos y variables de entorno (`.env`).

### 6. [Diseño UX/UI](./ux-ui/)
Diseño de la experiencia de usuario del MVP y [estilo común](./ux-ui/estilo.md) vigente (colores, tipografía y contraste).
- Definición de un sistema de diseño consistente y los wireframes para los tres módulos principales.