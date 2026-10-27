import { dbService } from './dbService';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

type EstadoSync = 'iniciando' | 'completado' | 'error' | 'reintentando';

interface DetallesSync {
  cantidad?: number;
  intento?: number;
  mensaje?: string;
}

// Función para emitir señales que nuestra pantalla de React va a escuchar (DoD 7.4)
const notificarUI = (estado: EstadoSync, detalles?: DetallesSync) => {
  window.dispatchEvent(new CustomEvent('sync-status', { detail: { estado, detalles } }));
};

interface IngresoBase {
  jti: string;
  fecha_escaneo: string;
  cantidad_personas: number;
  reserva_id: string | null;
}

interface IngresoQRPayload extends IngresoBase {
  tipo_ingreso: 'QR';
}

interface IngresoManualPayload extends IngresoBase {
  tipo_ingreso: 'MANUAL';
  monto_cobrado: number;
  nombre: string;
  dni: string;
}

type IngresoPayload = IngresoQRPayload | IngresoManualPayload;

interface ErrorIngreso {
  indice: number;
  jti: string | null;
  motivo: string;
}

interface SyncResponse {
  procesados: number;
  conflictos: number;
  sincronizados_jti: string[];
  errores: ErrorIngreso[];
}

type Pendiente = Awaited<ReturnType<typeof dbService.obtenerPendientesSincronizacion>>[number];

// Arma el ítem que viaja en el lote según sea QR o manual
const construirIngreso = (p: Pendiente): IngresoPayload => {
  const datos = p.qr_payload ?? {};
  const base: IngresoBase = {
    jti: p.jti,
    fecha_escaneo: p.fecha_escaneo.toISOString(),
    cantidad_personas: datos.cantidad_personas ?? 1,
    reserva_id: datos.reserva_id ?? null,
  };

  // Los registros manuales viejos que quedaron en la cola no tienen tipo_ingreso,
  // pero sí dni: se detectan por eso para que también se puedan sincronizar.
  const esManual = datos.tipo_ingreso === 'MANUAL' || datos.dni !== undefined;

  if (esManual) {
    return {
      ...base,
      tipo_ingreso: 'MANUAL',
      monto_cobrado: Number(datos.monto_cobrado ?? 0),
      nombre: datos.nombre,
      dni: datos.dni,
    };
  }
  return { ...base, tipo_ingreso: 'QR' };
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
      const payload = { ingresos: pendientes.map(construirIngreso) };

      // 3. Intento de envío al servidor
      const response = await fetch(`${API_URL}/api/v1/ingresos/bulk-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Falla HTTP: ${response.status}`);

      const data = (await response.json()) as SyncResponse;
      const sincronizados = data.sincronizados_jti ?? [];
      const errores = data.errores ?? [];

      // 4. Solo se borran de la cola los que el servidor confirmó
      if (sincronizados.length > 0) {
        await dbService.marcarComoSincronizados(sincronizados);
        notificarUI('completado', { cantidad: sincronizados.length });
      }

      // Los que vinieron con error se quedan en la cola
      if (errores.length > 0) {
        console.warn('[SyncQueue] Registros rechazados por el servidor:', errores);
        notificarUI('error', {
          mensaje: `${errores.length} registro(s) con errores no se pudieron sincronizar.`,
        });
      }

      this.isSyncing = false;
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      console.error(`[SyncQueue] Falla en intento ${intento}:`, mensaje);

      // SOLUCIÓN AL BUG DE LA ISSUE 8.4:
      // Liberamos el candado inmediatamente para no bloquear nuevos eventos 'online'
      this.isSyncing = false;

      // 5. Política de Reintentos: Backoff Exponencial (5s -> 15s -> 45s)
      if (intento <= 3) {
        setTimeout(() => {
          this.sincronizarIngresosPendientes(intento + 1, delay * 3);
        }, delay);
      } else {
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
  },
};