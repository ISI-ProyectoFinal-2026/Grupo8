import { dbService } from './dbService';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const syncService = {
  async sincronizarIngresosPendientes() {
    try {
      const pendientes = await dbService.obtenerPendientesSincronizacion();
      
      if (pendientes.length === 0) {
        console.log('✅ No hay ingresos pendientes por sincronizar.');
        return;
      }

      // 👇 ALERTA 1: Confirmamos que hay datos para enviar
      alert(`Debug: Iniciando sync de ${pendientes.length} registros...`);

      const payload = {
        ingresos: pendientes.map(p => ({
          jti: p.jti,
          reserva_id: p.qr_payload.reserva_id,
          fecha_escaneo: p.fecha_escaneo.toISOString()
        }))
      };

      // 👇 ALERTA 2: Verificamos qué URL armó exactamente Vite (CRÍTICO)
      alert(`Debug: Enviando fetch a ${API_URL}/api/ingresos/sync`);

      const response = await fetch(`${API_URL}/api/ingresos/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Error del servidor HTTP: ${response.status}`);
      }

      const data = await response.json(); 

      if (data.sincronizados && data.sincronizados.length > 0) {
        await dbService.marcarComoSincronizados(data.sincronizados);
        
        // 👇 ALERTA 3: Todo salió perfecto
        alert(`Debug: ¡ÉXITO! ${data.sincronizados.length} registros guardados en Postgres.`);
      }

      if (data.errores && data.errores.length > 0) {
        // 👇 ALERTA 4: El backend rechazó algunos datos
        alert(`Debug Error del Backend: ${JSON.stringify(data.errores)}`);
      }

    } catch (error: any) {
      // 👇 ALERTA 5: La petición falló antes de llegar, o el backend dio error crítico
      alert(`Debug Error Catch: ${error.message}`);
    }
  },

  iniciarBackgroundSync() {
    window.addEventListener('online', () => {
      this.sincronizarIngresosPendientes();
    });

    setInterval(() => {
      if (navigator.onLine) {
        this.sincronizarIngresosPendientes();
      }
    }, 5 * 60 * 1000); 
  }
};