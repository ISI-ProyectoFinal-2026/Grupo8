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

## Lista negra (decisión)
- Por ahora la PWA **no descarga** la lista negra del bootstrap: la ignora.
- Se conservan la tabla `blacklist`, `verificarAccesoRevocado` y `agregarABlacklist`,
  que la validación del QR ya consulta.
- Consecuencia: la tabla queda vacía en producción (el panel QA era la única forma de
  cargarla), así que una reserva cancelada puede ingresar sin conexión hasta la issue 17.
- La issue 17 tiene que resolver: la consulta real del backend (hoy es una lista fija de
  prueba), la descarga de todas las páginas, si reemplaza o suma a la lista local, el
  vencimiento de las entradas, la verificación de autenticidad y la relación con las
  alertas de clonación.