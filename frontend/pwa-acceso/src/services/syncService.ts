import { dbService } from './dbService';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Función para emitir señales que nuestra pantalla de React va a escuchar (DoD 7.4)
const notificarUI = (estado: 'iniciando' | 'completado' | 'error' | 'reintentando', detalles?: any) => {
  window.dispatchEvent(new CustomEvent('sync-status', { detail: { estado, detalles } }));
};

export const syncService = {
  // Candado para evitar envíos duplicados si la red parpadea
  isSyncing: false,

  // Motor con Backoff Exponencial incorporado
  async sincronizarIngresosPendientes(intento = 1, delay = 5000) {
    if (this.isSyncing && intento === 1) return; 
    this.isSyncing = true;

    try {
      // 1. Lectura FIFO (First In, First Out)
      const pendientes = await dbService.obtenerPendientesSincronizacion();
      
      if (pendientes.length === 0) {
        this.isSyncing = false;
        return;
      }

      // 2. Notificamos a la UI para el bloqueo visual discreto
      if (intento === 1) {
        notificarUI('iniciando', { cantidad: pendientes.length });
      } else {
        notificarUI('reintentando', { intento, cantidad: pendientes.length });
      }

      // Empaquetamos manteniendo el orden cronológico
      const payload = {
        ingresos: pendientes.map(p => ({
          jti: p.jti,
          reserva_id: p.qr_payload?.reserva_id || null, 
          fecha_escaneo: p.fecha_escaneo.toISOString(),
          tipo_ingreso: p.qr_payload?.tipo_ingreso || 'QR',
          cantidad_personas: p.qr_payload?.cantidad_personas || 1
        }))
      };

      // 3. Intento de envío al servidor
      const response = await fetch(`${API_URL}/api/ingresos/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`Falla HTTP: ${response.status}`);

      const data = await response.json(); 

      // 4. Éxito: Limpiamos la cola y avisamos a la interfaz
      if (data.sincronizados && data.sincronizados.length > 0) {
        await dbService.marcarComoSincronizados(data.sincronizados);
        notificarUI('completado', { cantidad: data.sincronizados.length });
      }

      this.isSyncing = false;

    } catch (error: any) {
      console.error(`[SyncQueue] Falla en intento ${intento}:`, error.message);
      
      // 5. Política de Reintentos: Backoff Exponencial (5s -> 15s -> 45s)
      if (intento <= 3) {
        setTimeout(() => {
          this.sincronizarIngresosPendientes(intento + 1, delay * 3);
        }, delay);
      } else {
        this.isSyncing = false;
        notificarUI('error', { mensaje: 'Sincronización pausada. Se reintentará al detectar red.' });
      }
    }
  },

  iniciarBackgroundSync() {
    // Escucha el evento nativo del navegador cuando vuelve el WiFi/4G
    window.addEventListener('online', () => {
      this.sincronizarIngresosPendientes();
    });

    // Contingencia: Intentar limpiar la cola cada 5 minutos si hay red
    setInterval(() => {
      if (navigator.onLine) {
        this.sincronizarIngresosPendientes();
      }
    }, 5 * 60 * 1000); 
  }
};