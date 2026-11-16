# Bootstrap de la PWA y lista negra

## Capacidad máxima
- Se descarga de `GET /api/v1/sincronizacion/bootstrap` y se guarda en IndexedDB
  (`configuracion` → `capacidad_maxima`).
- Se pide al abrir Control de Acceso y cada vez que vuelve la conexión. Si falla, se sigue
  con el valor guardado.
- Si nunca se descargó (primer arranque sin red), la capacidad es desconocida: la pantalla
  lo avisa, el guardia puede seguir registrando ingresos y no se controla el cupo hasta
  conectarse una vez.
- La app nunca usa un valor inventado. La versión 3 de la base local borra el `'500'`
  que guardaban las versiones anteriores.

## Lista de reservas canceladas (blacklist)
Desde la Issue 20.4 la lista es real y la PWA la usa para rechazar QR sin conexión.

### Backend
- `GET /api/v1/sincronizacion/bootstrap` devuelve en `blacklist` los ids de las reservas
  en estado `CANCELADA` que egresan hoy o después (fecha de Buenos Aires). Las que ya
  terminaron no se mandan: su QR ya no sirve.
- Paginación: `page` (desde 1) y `limit` (de 1 a 1000; otro valor da 422). El orden por id
  es fijo, así las páginas no se pisan. `tiene_mas_paginas` indica si falta alguna.
- Solo para los roles SEGURIDAD y ADMIN: sin token responde 401 y con otro rol, 403.
- Las reservas en `ALERTA_CLONACION` no entran: bloquearlas frenaría también al titular
  legítimo hasta que un administrador revise la alerta.

### PWA
- En cada sincronización (al abrir Control de Acceso y cuando vuelve la conexión) se
  descargan todas las páginas, con el token del guardia.
- La lista local se **reemplaza** completa en una sola transacción. Así una reserva que ya
  pasó, o que dejó de estar cancelada, se va sola en la siguiente descarga.
- Si una página falla, viene con un formato inválido o el servidor no termina de paginar
  (más de 100 páginas), se conserva la lista anterior completa: nunca queda una lista a
  medias. La capacidad se guarda aunque falle la lista, y al revés.
- Con 401 se cierra la sesión del guardia, igual que en la sincronización de ingresos.
- Al escanear, `ControlAcceso` busca el `reserva_id` del QR en la lista local y, si está,
  muestra "Reserva Cancelada / Acceso Revocado" y no registra el ingreso.

Desde la Issue 22 las reservas llegan a `CANCELADA` cuando el socio cancela desde Mis
reservas. La prueba E2E de la 24.3 cubre el recorrido completo: cancelar en la web, descargar
la lista y rechazar el QR sin conexión.

### Pendiente
- La lista se actualiza solo al abrir Control de Acceso o al volver la conexión. Si el guardia
  tiene la app abierta desde antes de una cancelación y pierde la señal sin recargar, ese QR
  todavía entra.
- La PWA controla la firma y el vencimiento del QR, pero no su fecha de ingreso (`dat`): el
  QR de una reserva futura se acepta hoy.
