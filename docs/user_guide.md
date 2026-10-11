# Guía de Usuario - Qamp

Esta guía explica cómo utilizar la plataforma Qamp desde dos perspectivas principales: el cliente (visitante/socio) que realiza la reserva, y el personal de seguridad (guardia) que gestiona el control de accesos en la entrada del predio.

_Proximamente también se incluirá la perspectiva del administrador del dashboard._

## 1. Portal Web (Clientes y Socios)

### 1.1. Búsqueda de reserva

El usuario puede ingresar a la plataforma y utilizar el buscador para encontrar disponibilidad.
Para iniciar, se deben ingresar parámetros de búsqueda específicos como la fecha deseada, la cantidad de personas y el tipo de alojamiento. En caso de que se seleccione un alojamiento con estadía, se pedirá indicar también el numero de días.
El sistema consultará los cupos en tiempo real y mostrará una pantalla de resultados indicando el éxito o fallo de la disponibilidad.

### 1.2. Proceso de Reserva y Pago

Una vez confirmada la disponibilidad, el cliente avanza al formulario de reservas.
El sistema genera dinámicamente los campos para ingresar los datos según la cantidad de visitantes declarada.
Si un visitante se identifica como "Socio", el campo de "DNI" se vuelve obligatorio para poder validar su identidad.
El panel lateral incluye un sistema de tarifas dinámicas que calcula los subtotales en tiempo real y aplica descuentos, como el descuento para socios.
El pago se procesa de forma segura a través de la integración con Mercado Pago.
Finalizado el proceso, el usuario será redirigido a una vista específica (éxito, rechazo o pendiente) para conocer el resultado visual de su transacción.

### 1.3. Autogestión y Panel de Usuario

Los clientes pueden iniciar sesión en el portal utilizando su DNI o correo electrónico.
Dentro del apartado "Perfil", los usuarios pueden visualizar el estado de su cuenta, identificado con etiquetas como "Activo" o "Inactivo".
En la sección "Mis Reservas", el sistema ofrece un historial clasificado en pestañas para reservas "Próximas", "Finalizadas" y "Canceladas".
Desde este historial, el cliente tiene botones de acción directa para cancelar una estadía o descargar su código QR de acceso.
Adicionalmente, existe una pestaña de "Pendientes" con un botón de "Verificar Pago", el cual permite auditar manualmente transacciones que hayan quedado demoradas por intermitencias de red.

## 1.4. Recepción de la Credencial de Acceso

Cuando Mercado Pago aprueba el cobro, el sistema automáticamente marca la reserva como pagada y emite una credencial digital única.
El cliente recibe un correo electrónico de confirmación que incluye los detalles de su compra (nombre, fecha, monto) y el código QR visible directamente en el cuerpo del mensaje.
Este código QR es el que el visitante deberá mostrar desde su celular al llegar al camping.

## 2. Aplicación Móvil (PWA) para Guardias

La PWA de control de accesos está diseñada para funcionar de manera ininterrumpida (*offline-first*), garantizando que las filas avancen incluso si el camping pierde la conexión a internet.

### 2.1. Instalación de la Aplicación

Al ingresar a la URL del sistema desde el navegador del dispositivo, el guardia puede instalar la aplicación tocando el ícono de monitor en la barra de direcciones, o desde el menú del navegador seleccionando "Instalar Sistema de Acceso".
Si la aplicación no refleja los últimos cambios visuales (debido al guardado en caché de los *Service Workers*), se recomienda recargar forzando la limpieza con `Ctrl + F5` o desregistrando el *Service Worker* desde el inspector del navegador.

### 2.2. Preparación del Turno (Modo Online)

Antes de comenzar a operar en la barrera de entrada, el guardia debe abrir la PWA estando conectado a internet.
En esta carga inicial, la aplicación descargará en la base de datos local del dispositivo la configuración de capacidad máxima, la clave criptográfica para leer los QR y una lista negra con las reservas que fueron canceladas.

### 2.3. Escaneo y Validación (Modo Offline)

Cuando llega un visitante, debe mostrar el código QR en su pantalla.
El guardia utiliza el escáner de la PWA, el cual se pausa instantáneamente al detectar un código para evitar lecturas repetidas por accidente.
Sin necesidad de consultar al servidor, la aplicación realiza cálculos matemáticos para asegurar que la firma sea auténtica, que la fecha sea la correcta y que el QR no figure en la lista negra ni haya sido escaneado previamente.
Si el código es válido, se aprueba el acceso mostrando una pantalla verde; de lo contrario, se deniega el ingreso.

### 2.4. Ingresos Manuales y Control de Aforo

La PWA incluye un tablero que muestra en tiempo real cuántas personas han ingresado.
El guardia posee una interfaz para registrar manualmente ingresos espontáneos (personas sin reserva previa) o gestionar contingencias.
El sistema evalúa la capacidad máxima localmente y, si el camping se llena, desactiva automáticamente el botón de escaneo para evitar la sobreventa de lugares.

### 2.5. Sincronización Automática

Cada ingreso validado sin internet se guarda de manera segura en el almacenamiento interno del dispositivo móvil.
Tan pronto como el teléfono recupere la señal de internet, la aplicación enviará automáticamente todos los registros pendientes al servidor en un solo paquete de datos.
El guardia puede observar este proceso a través de indicadores visuales en la interfaz que cambian de "Sincronizando" a "Datos Actualizados", sin que esto interrumpa su capacidad para seguir escaneando.