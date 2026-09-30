# Reporte de QA - Issue 7.6 (Pruebas Offline End-to-End)

## Resumen de Ejecución
Se realizaron pruebas de estrés simulando un entorno sin conectividad utilizando Chrome DevTools (Network -> Offline).

## Resultados de Criterios de Aceptación (DoD)
- [x] **Simulación Offline:** Configurada correctamente.
- [x] **Validación Blacklist:** Se simuló la reserva `9999` mediante el panel QA. Al escanearla offline, el sistema bloqueó el acceso utilizando la lógica local.
- [x] **Persistencia Offline:** Se procesaron QRs válidos y 1 ingreso manual. La capacidad local se actualizó correctamente y los registros se encolaron.
- [x] **Sincronización Automática:** Al reestablecer la red, el `syncService` capturó el evento nativo, enviando la cola automáticamente (comprobado en pestaña Network).

**Estado:** APROBADO ✅