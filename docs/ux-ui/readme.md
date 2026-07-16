# Issue 3 - Diseño de Interfaz (UI/UX)

### Objetivo

Diseñar la experiencia de usuario del MVP del SGIC, definiendo un sistema de diseño consistente y los wireframes para los tres módulos principales:

- Portal Web de Reservas
- PWA de Acceso
- Dashboard Administrativo

### Herramientas utilizadas

Figma

Enlace: https://www.figma.com/design/bsTVVmQAA0MQQJsNLO7dWv/Camila-Barrera-s-team-library?node-id=3317-17&t=a2lwtgANhmMIjxZJ-1

---

## 3.1 Design System

### Objetivo

Definir una identidad visual consistente para todo el sistema.

### Colores

| Uso              | Color | Hex |
|------------------|--------|---------|
| Primary          | Verde claro   | #BBDBBC |
| Success          | Verde  | # |
| Button | Verde oscuro | #1B5E20
| Danger           | Rojo   | #DC2626 |
| Warning          | Ámbar  | #F59E0B |
| Background       | Gris muy claro | #F7F8FA |
| Surface          | Blanco | #FFFFFF |
| Border           | Gris claro | #D9D9D9 |
| Text             | Gris oscuro | #1D1B20 |
| Text secundario  | Gris medio | #757575 |

### Tipografía

- Inter
- Pesos:
    - 700 títulos
    - 600 subtítulos
    - 400 texto

### Componentes

Se decidió utilizar **Shadcn UI** por:

- Accesibilidad
- Componentes reutilizables
- Compatibilidad con React + Vite
- Fácil personalización

---

## 3.2 Portal Web

### Flujo diseñado

```text
Home
│
├── Beneficios
├── Acerca de
├── Contacto
├── Iniciar sesión
│      │
│      └── Home (logueado)
│              ├── Mi perfil
│              ├── Mis reservas
│              └── Reservar
│
└── Consultar disponibilidad
        │
        ├── No hay disponibilidad
        │       └── Modificar búsqueda
        │
        └── Hay disponibilidad
                │
             Reservar
                │
          Mercado Pago
        ┌───────┴────────┐
Pago rechazado      Pago aprobado
        │                │
Reintentar pago   Reserva realizada
        	        ├── Descargar QR
        	        ├── Cancelar reserva
        	        ├── Mis reservas
        	        └── Nueva reserva
```

### Pantallas 

**Pantallas diseñadas**

- Home
- Inicio de sesión
- Disponibilidad (Si hay)
- Disponibilidad (No hay)
- Reservar
- Reserva realizada

**Pantallas contempladas**

Además del flujo principal de reserva, el sistema contempla las siguientes pantallas:

- Beneficios
- Acerca de nosotros
- Contacto
- Mi perfil
- Mis reservas

Estas vistas forman parte de la navegación del portal y fueron consideradas durante el diseño de la arquitectura de información. Sin embargo, no fueron prototipadas en esta iteración, ya que el objetivo del Sprint 1 fue priorizar el diseño del flujo crítico de reserva y acceso definido en los criterios de aceptación de la Issue 3. Su diseño visual será abordado en futuras iteraciones sin afectar la experiencia principal del usuario.

---

## 3.3 PWA de acceso

### Flujo diseñado

```text
Login
   │
Pantalla principal (Escáner)
   │
   ├── Escanear QR
   │      │
   │      ├── QR válido → Mostrar "Acceso permitido" → Registrar ingreso
   │      ├── QR duplicado → Mostrar "Acceso rechazado"
   │      ├── QR cancelado → Mostrar "Acceso rechazado"
   │      └── QR inválido/firma incorrecta → Mostrar "Acceso rechazado"
   │
   ├── Registro manual
   │      └── Confirmación del ingreso
   │
   ├── Historial
   └── Estado de sincronización
```

### Pantallas 

**Pantallas diseñadas**

- Inicio de sesión
- Escaner
- Acceso permitido
- Acceso rechazado
- Registro manual
- Confirmación de registro
- Historial
- Estado de sincronización - conectado
- Estado de sincronización - no conectado
- Cerrar sesión

## 3.4 Dashboard administrativo

### Flujo diseñado

```text
Login
   │
Inicio (Dashboard)
   │
   ├── Reservas
   │      └── Ver detalle
   │
   ├── Historial
   │
   ├── Configuración
   │      └── Guardar cambios
   │
   └── Menú de usuario
          ├── Cambiar contraseña
          └── Cerrar sesión
```

### Pantallas 

**Pantallas diseñadas**

- Inicio de sesión
- Inicio (dashboard)
- Gestión de reservas
- Historial de ingresos
- Configuración

**Pantallas contempladas**

- Menú de usuario
- Modo offline

El diseño de estas pantallas fue omitido por seguir patrones de interfaz estándar y no requerir validación en esta etapa del proyecto.