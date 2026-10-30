# Manejo de zonas horarias

- **Guardado:** todo instante se guarda en UTC, en columnas `timestamptz`
  (`ingresos_fisicos.fecha_hora_ingreso`, `conflictos_sincronizacion.fecha_registro`).
- **Entrada:** la PWA manda ISO 8601 con zona (`2026-10-25T14:30:00.000Z`). El schema
  (`FechaEscaneo`) la convierte a UTC. Una fecha sin zona se rechaza, y el ítem queda en `errores`.
- **Zona del negocio:** `America/Argentina/Buenos_Aires`, definida en `core/tiempo.py`.
  Se usa solo al mostrar una hora y para saber en qué día cae un instante (`a_zona_negocio`).
- **Hora del escaneo:** `fecha_hora_ingreso` es la hora en que el guardia escaneó, no la de
  llegada al servidor. La hora la dicta el reloj del celular.
- **Orden:** el backend procesa el lote en el orden recibido y no lo reordena.
- **Fechas antiguas:** las otras columnas de fecha del proyecto siguen sin zona y se leen como UTC.