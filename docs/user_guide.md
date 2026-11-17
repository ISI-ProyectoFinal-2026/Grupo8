# Guía de Usuario - Qamp

Esta guía explica cómo utilizar la plataforma Qamp desde tres perspectivas: el cliente (visitante/socio) que realiza la reserva, el personal de seguridad (guardia) que gestiona el control de accesos en la entrada del predio y el administrador que sigue la operación desde el panel.

## 1. Portal Web (Clientes y Socios)

### 1.1. Búsqueda de reserva

El usuario puede ingresar a la plataforma y utilizar el buscador para encontrar disponibilidad.
Para iniciar, se deben ingresar parámetros de búsqueda específicos como la fecha deseada, la cantidad de personas y el tipo de alojamiento. En caso de que se seleccione un alojamiento con estadía, se pedirá indicar también el numero de días.
El sistema consultará los cupos en tiempo real y mostrará una pantalla de resultados indicando el éxito o fallo de la disponibilidad.

### 1.2. Proceso de Reserva y Pago

Una vez confirmada la disponibilidad, el cliente avanza al formulario de reservas.
El sistema genera dinámicamente los campos para ingresar los datos (nombre, edad y condición) de cada persona según la cantidad de visitantes declarada.
Si un visitante se identifica como "Socio", el campo de "DNI" se vuelve obligatorio y el sistema verifica que corresponda a un socio con la cuota al día; si no es así, no se puede continuar con la reserva.
Si quien reserva es un socio con la sesión iniciada, sus datos ya aparecen cargados.
El correo electrónico se escribe dos veces para evitar errores, ya que es la dirección a la que llega el código QR.
El panel lateral muestra el subtotal, los descuentos (por ejemplo, el de socios o por edad) y el total, calculados por el sistema cada vez que cambian los datos de las personas.
El pago se procesa de forma segura a través de la integración con Mercado Pago.
Después de tocar "Pagar", la reserva queda guardada y hay 10 minutos para pagarla: la pantalla muestra la cuenta regresiva y el botón "Ir a pagar". Si el tiempo se termina, la reserva vence, los lugares quedan libres y se puede empezar de nuevo. El pago en efectivo (Pago Fácil, Rapipago) no está disponible, porque se acredita días después.
Si Mercado Pago rechaza el pago, "Intentar nuevamente" vuelve a la pantalla de pago con el tiempo que queda.
Finalizado el proceso, el usuario será redirigido a una vista específica (éxito, rechazo o pendiente) para conocer el resultado visual de su transacción. Si el pago se aprueba, Mercado Pago vuelve solo a la web, en hasta 40 segundos; también se puede tocar "Volver al sitio".

### 1.3. Autogestión y Panel de Usuario

Los clientes pueden iniciar sesión en el portal utilizando su DNI o correo electrónico; al ingresar van directamente a "Mis Reservas". Este inicio de sesión es solo para clientes y socios: los guardias y los administradores tienen el suyo, en su propia app (ver secciones 2.2 y 3).
La web muestra el nombre, los horarios y los datos de contacto del camping. El pie de página incluye el enlace "Botón de arrepentimiento".
Las secciones "Perfil" y "Mis Reservas" son exclusivas para socios. Se puede reservar sin iniciar sesión, pero esas reservas no aparecen en ningún listado personal.
Dentro del apartado "Perfil", los socios pueden visualizar el estado de su membresía: "Membresía vigente" (con la fecha hasta la que está al día) o "Membresía vencida". Un socio con la cuota vencida igualmente puede iniciar sesión, para ver su estado.
En la sección "Mis Reservas", el sistema ofrece un historial clasificado en pestañas para reservas "Próximas", "Finalizadas" y "Canceladas".
En las reservas "Próximas", el botón "Descargar QR" baja el mismo código QR de acceso que llegó por correo, por si el cliente no encuentra el mensaje. También se puede descargar apenas se paga, desde la pantalla "¡Reserva Realizada!", con o sin cuenta. Esa pantalla consulta el estado real del pago: muestra "¡Reserva Realizada!" solo cuando la reserva quedó confirmada; mientras Mercado Pago lo confirma, muestra "Estamos confirmando tu pago" y vuelve a consultar sola. El botón "Cancelar" muestra hasta cuándo se puede cancelar y cuánto se devuelve, y pide confirmación ("¿Está seguro que desea cancelar?").
Adicionalmente, existe una pestaña de "Pendientes" con un botón de "Verificar Pago", el cual permite auditar manualmente transacciones que hayan quedado demoradas por intermitencias de red. Si el pago se confirma así, el código QR llega por correo igual que con la confirmación automática.

### 1.3.1. Botón de Arrepentimiento (cancelar sin cuenta)

Cualquier persona puede cancelar una reserva sin iniciar sesión:

1. En el pie de cualquier pantalla de la web, tocar "Botón de arrepentimiento".
2. Escribir el email con el que se hizo la reserva y tocar "Enviar enlace". La pantalla siempre responde "Si hay reservas con ese email, te enviamos un correo con un enlace para cada una."
3. En el correo hay un enlace por cada reserva pagada y próxima. Abrir el de la reserva a cancelar (por defecto vence a la hora; si vence, se pide otro).
4. La pantalla muestra hasta cuándo se puede cancelar y cuánto se devuelve. Tocar "Confirmar cancelación".
5. Se muestra el resultado y un código de gestión, que también llega por correo. Las demás reservas no cambian.

Dentro de los 10 días corridos desde que se hizo la reserva, y hasta el día anterior al ingreso, se devuelve el total. Fuera de ese plazo rigen las condiciones de cancelación del camping. La misma regla vale para los socios que cancelan desde "Mis Reservas". El correo con el QR también trae el enlace al botón de arrepentimiento.

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

Antes de comenzar a operar en la barrera de entrada, el guardia debe iniciar sesión en `/acceso/login` con su usuario estando conectado a internet; al hacerlo, el sistema lo lleva directamente al escáner. Ese inicio de sesión es solo para guardias: con un usuario de otro rol se muestra "Acceso denegado".
La sesión del guardia dura 7 días. Si vence mientras no hay conexión, puede seguir escaneando y registrando ingresos sin problema; al volver la red, el sistema le pedirá iniciar sesión nuevamente y los ingresos pendientes se envían después, sin perderse ninguno.
En esta carga inicial, la aplicación descargará en la base de datos local del dispositivo la configuración de capacidad máxima, la clave criptográfica para leer los QR y una lista negra con las reservas que fueron canceladas.

Para moverse dentro de la app:

* **Barra inferior:** Historial, Registro manual, Escáner, Sincronización y Cerrar sesión. La opción de la pantalla actual queda resaltada.
* **Barra superior:** el título de la pantalla, el indicador "Online" u "Offline" y cuántos ingresos faltan sincronizar ("Todo sincronizado" cuando no queda ninguno).

Todas las pantallas funcionan sin conexión, también si se recarga la app.

### 2.3. Escaneo y Validación (Modo Offline)

Cuando llega un visitante, debe mostrar el código QR en su pantalla.
El guardia utiliza el escáner de la PWA, el cual se pausa instantáneamente al detectar un código para evitar lecturas repetidas por accidente.
Sin necesidad de consultar al servidor, la aplicación realiza cálculos matemáticos para asegurar que la firma sea auténtica, que la fecha sea la correcta y que el QR no figure en la lista negra ni haya sido escaneado previamente.
Si el código es válido, se aprueba el acceso mostrando una pantalla verde; de lo contrario, se deniega el ingreso.

### 2.4. Ingresos Manuales y Control de Aforo

La PWA incluye un tablero que muestra en tiempo real cuántas personas han ingresado.
Desde "Registro manual", en la barra inferior, el guardia registra ingresos espontáneos (personas sin reserva previa) o gestiona contingencias. Al guardar se muestra "Ingreso registrado" con el ID local del ingreso; "Aceptar" vuelve al escáner.
El sistema evalúa la capacidad máxima localmente y, si el camping se llena, desactiva automáticamente el botón de escaneo para evitar la sobreventa de lugares.

### 2.5. Sincronización Automática

Cada ingreso validado sin internet se guarda de manera segura en el almacenamiento interno del dispositivo móvil.
Tan pronto como el teléfono recupere la señal de internet, la aplicación enviará automáticamente todos los registros pendientes al servidor en un solo paquete de datos.
El guardia puede observar este proceso a través de indicadores visuales en la interfaz que cambian de "Sincronizando" a "Datos Actualizados", sin que esto interrumpa su capacidad para seguir escaneando.

* **Historial:** los últimos 50 ingresos de ese celular, del más nuevo al más viejo, con reserva (o "Ingreso manual"), hora, personas y estado: "Pendiente" o "Sincronizado".
* **Sincronización:** conexión, hora de la última sincronización, pendientes y el botón "Sincronizar ahora". Sin conexión o sin pendientes el botón no se puede usar, y la pantalla dice por qué.
* **Sesión vencida:** si al sincronizar la sesión ya no es válida, la app vuelve al inicio de sesión con el aviso "Iniciá sesión de nuevo para sincronizar". Los ingresos siguen guardados en el celular y se envían después de entrar.

## 3. Panel de Administración

El administrador accede al panel desde `/admin/login`. Ese inicio de sesión es solo para administradores: con un usuario de otro rol se muestra "Acceso denegado". El menú lateral reúne las secciones de gestión: Inicio, Gestión de reservas, Socios, Descuentos, Historial de ingresos, Egresos, Alertas y Tipos de reserva; Configuración queda al final, encima de "Cerrar sesión".

El panel se puede instalar como una app aparte ("Qamp Admin"): con el panel abierto, desde el ícono de instalación de la barra de direcciones o el menú del navegador. Se abre directamente en el panel, separada de la app del guardia.

### 3.1. Monitor de Ocupación

La pantalla de Inicio muestra cuántas personas hay dentro del camping sobre la capacidad máxima y el porcentaje que representan.
La barra cambia de color según el nivel: verde (ocupación normal, menos del 70 %), amarillo (alta, desde el 70 %) y rojo (crítica, desde el 90 %).
El tramo rayado al final de la barra indica el buffer offline: los lugares que no se venden online y quedan para los ingresos en la puerta.
El monitor se actualiza solo cada 30 segundos. Los ingresos que los guardias registran sin conexión se suman recién cuando sincronizan, por lo que el valor puede ir levemente atrasado.

Arriba del monitor, un aviso indica si hay incidentes de acceso sin resolver (QR clonados), con un acceso directo a "Alertas".

Al lado del monitor se muestran las **personas esperadas**: cuántas reservas pagadas tienen estadía hoy y todavía no llegaron, y cuántas personas suman. Una reserva deja de contarse en cuanto el guardia escanea su QR. Estas personas no se suman a la ocupación hasta que entran.

### 3.2. Registro de Egresos

Desde la sección "Egresos" el administrador registra cuántas personas salen del camping. El egreso se guarda con la fecha y hora del momento en que se carga.
El sistema no permite registrar la salida de más personas de las que hay dentro, y al confirmar el egreso el monitor se actualiza de inmediato.

### 3.3. Resumen de Cobros

Debajo del monitor, en la pantalla de Inicio, se muestra lo cobrado en la última semana: el total en efectivo (ingresos manuales registrados por los guardias), el total por Mercado Pago (solo pagos aprobados) y el total general, con el detalle día por día.
Se puede elegir otro período con las fechas "Desde" y "Hasta", de hasta 92 días.

### 3.4. Gestión de Reservas

La sección "Gestión de reservas" muestra todas las reservas, las más nuevas primero, de a 20 por página.

* **Buscar:** por nombre del titular, email o número de reserva, sin importar acentos ni mayúsculas.
* **Filtrar:** por estado de pago, estado de la reserva, fechas de ingreso y socio o visitante. Los filtros se pueden combinar.
* **Ver detalle:** abre una ventana con las personas de la reserva, el tipo de reserva, los pagos de Mercado Pago (con la devolución, si la hubo) y si ya ingresó al camping.

La pantalla es solo de consulta: desde ahí no se modifica ninguna reserva.

### 3.5. Socios

La sección "Socios" muestra el padrón con el estado de cada socio: Vigente, Vencida o De baja.

* **Buscar:** un solo campo, por DNI (con o sin puntos) o por nombre, sin importar acentos ni mayúsculas. La lista se actualiza sola mientras se escribe. El selector de estado filtra vigentes, vencidos o dados de baja.
* **Nuevo socio:** el administrador carga nombre, DNI, correo, contraseña inicial y la fecha hasta la que la cuota está al día. Si el DNI o el correo ya existen, el sistema avisa y no crea nada. El socio entra con su DNI o su correo y esa contraseña. No hay registro desde la web: las altas se hacen solo desde el panel.
* **Editar:** corrige nombre, DNI o email.
* **Renovar:** propone un año más desde el vencimiento actual, o desde hoy si ya venció. No acepta fechas pasadas.
* **Dar de baja:** pide confirmación. El socio no puede iniciar sesión ni validar como socio, pero sus reservas se conservan. Se deshace con "Reactivar".

### 3.6. Alertas de Clonación

Si dos guardias registraron el mismo QR desde celulares distintos, la reserva queda en alerta y aparece en "Alertas" con el titular y cuándo se detectó. Las dos personas ya entraron: el sistema no expulsa a nadie, solo avisa.

Después de revisar el caso, el administrador aprieta "Resolver incidente" (puede dejar una nota). La reserva vuelve al estado que tenía, o queda confirmada si el pago entró mientras estaba en alerta, y queda registrado quién la resolvió y cuándo.

### 3.7. Historial de Ingresos

La sección "Historial de ingresos" lista los ingresos al camping de todos los guardias, los más nuevos primero, de a 20 por página: hora de escaneo (de Buenos Aires), reserva o "Manual", personas, socio o visitante, y tipo de ingreso (web o manual). Muestra hoy por defecto; con "Desde" y "Hasta" se elige un día o un período de hasta 92 días.

Los ingresos que un guardia registró sin conexión aparecen recién cuando su celular se sincroniza. Los intentos rechazados por QR clonado no figuran: se ven en "Alertas".
