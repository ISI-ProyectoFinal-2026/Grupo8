# Qamp - Documentación

Esta documentación está estructurada bajo el modelo *Docs as Code* para acompañar el desarrollo híbrido (B2B2C) de nuestro proyecto, constituído por tres módulos principales: una plataforma de reservas, una aplicación PWA orientada al control de accesos y un dashboard administrativo.

## Índice de Contenidos

### 1. [Guía de Usuario](./user_guide.md)
Manual operativo del software. Cubre:
- El ciclo de vida de una reserva y la emisión del código QR.
- Cómo los guardias deben operar la aplicación móvil (PWA) sin conexión a internet.
- Navegación del cliente en el buscador, pasarela de pagos y autogestión de perfil.

### 2. [Documentación Técnica](./technical_documentation.md)
Arquitectura y decisiones de diseño interno:
- **Backend:** FastAPI, PostgreSQL, SQLAlchemy y migraciones con Alembic.
- **Frontend:** React, Vite y arquitecturas de interfaz con Shadcn UI.
- **Seguridad Offline:** Criptografía asimétrica (ES256), IndexedDB, Dexie.js y el motor de validación local mediante la *Web Crypto API*.
- **Comunicaciones:** Orquestación asíncrona para la generación de correos electrónicos y códigos QR en memoria RAM (Resend + Jinja2).

### 3. [Guía de Pruebas (Testing)](./testing_guide.md)
Instrucciones para mantener la calidad del software:
- Ejecución de suites con `pytest` (Backend) y `vitest` (Frontend).
- Pruebas del motor criptográfico y manipulación de JWT.
- Entornos de simulación de caídas de red y configuración de `ngrok` para testing de hardware (cámara) en móviles.

### 4. [Referencia de la API](./api_reference.md)
Definición estricta de contratos de datos y endpoints:
- Modelos principales (Usuarios, Reservas, Configuraciones).
- Motor de reglas, cálculo dinámico de tarifas y validaciones de cupos.
- Endpoints de sincronización transaccional (`/bootstrap`, `/bulk-sync`) y webhooks financieros (Mercado Pago).

### 5. [Guía de Despliegue (Deployment)](./deployment.md)
Cómo llevar la plataforma a entornos de producción:
- Integración y despliegue continuo (CI/CD) automatizado en GitHub Actions.
- Infraestructura Frontend hospedada en Vercel.
- Infraestructura Backend hospedada en Render.
- Gestión estricta de secretos y variables de entorno (`.env`).

### 6. [Diseño UX/UI](./ux-ui/)
Diseño de la experiencia de usuario del MVP.
- Definición de un sistema de diseño consistente y los wireframes para los tres módulos principales.