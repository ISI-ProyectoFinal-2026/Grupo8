import { db, type HistorialIngreso } from '../db/db';
import { generarJti } from '../utils/jti';

/** Cuántos ingresos guarda el historial del dispositivo. Los más viejos se borran solos. */
export const MAX_HISTORIAL = 50;

// Copia liviana del ingreso para la pantalla de Historial: sin nombre, DNI ni monto
function filaHistorial(jti: string, payload: any, fecha: Date): HistorialIngreso {
  // Mismo criterio que syncService: los manuales viejos de la cola no traen tipo_ingreso, pero sí dni
  const esManual = payload?.tipo_ingreso === 'MANUAL' || payload?.dni !== undefined;
  return {
    jti,
    reserva_id: esManual || payload?.reserva_id == null ? null : String(payload.reserva_id),
    tipo: esManual ? 'MANUAL' : 'QR',
    cantidad_personas: Number(payload?.cantidad_personas ?? 1),
    fecha_ingreso: fecha,
    estado: 'pendiente',
  };
}

/**
 * Deja solo los últimos MAX_HISTORIAL. Trabaja únicamente sobre `historial`: un ingreso que
 * todavía no se sincronizó sigue en `ingresos_pendientes` aunque ya no aparezca en la lista.
 * Como se llama en cada alta, en la práctica sobra a lo sumo una fila.
 */
async function recortarHistorial(): Promise<void> {
  const sobrantes = (await db.historial.count()) - MAX_HISTORIAL;
  if (sobrantes <= 0) return;
  // Con la misma fecha, el índice desempata por id: se va siempre el que se guardó primero
  const masViejos = await db.historial.orderBy('fecha_ingreso').limit(sobrantes).primaryKeys();
  await db.historial.bulkDelete(masViejos);
}

export const dbService = {
  // ==========================================
  // STORES: CONFIGURACIÓN
  // ==========================================
  async guardarConfiguracion(clave: string, valor: any): Promise<void> {
    await db.configuracion.put({ clave, valor });
  },

  async obtenerConfiguracion(clave: string): Promise<any | undefined> {
    const config = await db.configuracion.get(clave);
    return config?.valor;
  },
  
  async obtenerOcupacion(): Promise<number> {
    const ocupacion = await db.configuracion.get('ocupacion_actual');
    return ocupacion ? parseInt(ocupacion.valor, 10) : 0;
  },

  async obtenerCapacidadMaxima(): Promise<number | null> {
    const config = await db.configuracion.get('capacidad_maxima');
    if (!config) return null;
    const capacidad = Number(config.valor);
    return Number.isInteger(capacidad) && capacidad > 0 ? capacidad : null;
  },

  async guardarCapacidadMaxima(capacidad: number): Promise<void> {
    await db.configuracion.put({ clave: 'capacidad_maxima', valor: String(capacidad) });
  },

  // ==========================================
  // STORES: INGRESOS PENDIENTES (OFFLINE)
  // ==========================================
  async registrarIngresoOffline(jti: string, payload: any): Promise<number> {
    // El ingreso y su fila del historial se guardan juntos: o quedan los dos o ninguno
    return await db.transaction('rw', db.ingresos_pendientes, db.configuracion, db.historial, async () => {
      
      const existe = await db.ingresos_pendientes.where('jti').equals(jti).first();
      if (existe) {
        throw new Error('QR_DUPLICADO: Este código ya fue escaneado y registrado.');
      }

      const ocupacionActual = await this.obtenerOcupacion();
      const capacidadMaxima = await this.obtenerCapacidadMaxima();
      const nuevasPersonas = payload.cantidad_personas;

      // Sin capacidad descargada no se controla el cupo (la pantalla ya avisa)
      if (capacidadMaxima !== null && ocupacionActual + nuevasPersonas > capacidadMaxima) {
        const lugaresDisponibles = capacidadMaxima - ocupacionActual;
        throw new Error(`CAPACIDAD_EXCEDIDA: Solo quedan ${lugaresDisponibles} lugares disponibles, y el grupo es de ${nuevasPersonas}.`);
      }

      const nuevaOcupacion = ocupacionActual + nuevasPersonas;
      await db.configuracion.put({ clave: 'ocupacion_actual', valor: nuevaOcupacion.toString() });

      const fechaEscaneo = new Date();
      const idGenerado = await db.ingresos_pendientes.add({
        jti,
        qr_payload: payload,
        fecha_escaneo: fechaEscaneo,
        sincronizado: false
      });

      await db.historial.add(filaHistorial(jti, payload, fechaEscaneo));
      await recortarHistorial();

      return idGenerado as number;
    });
  },

  async obtenerPendientesSincronizacion() {
    const pendientes = await db.ingresos_pendientes
      .filter((ingreso: any) => ingreso.sincronizado === false)
      .toArray();

    // Orden FIFO por timestamp de negocio (Issue 8.3): Dexie no garantiza
    // que table.filter() devuelva los registros ordenados por
    // fecha_escaneo (solo respeta el orden físico de la clave primaria),
    // así que se ordena explícitamente en memoria por orden cronológico
    // ascendente antes de devolver la cola.
    return pendientes.sort(
      (a, b) => a.fecha_escaneo.getTime() - b.fecha_escaneo.getTime()
    );
  },

  async marcarComoSincronizado(id: number): Promise<void> {
    await db.ingresos_pendientes.update(id, { sincronizado: true });
  },

  async obtenerIngresosPendientes() {
    const pendientes = await db.ingresos_pendientes
      .filter((ingreso: any) => ingreso.sincronizado === false)
      .toArray();

    return pendientes.sort(
      (a, b) => a.fecha_escaneo.getTime() - b.fecha_escaneo.getTime()
    );
  },

  // Solo cuenta, sin traer los datos de cada visitante (lo usa el indicador de la barra superior)
  async contarIngresosPendientes(): Promise<number> {
    return await db.ingresos_pendientes
      .filter((ingreso) => ingreso.sincronizado === false)
      .count();
  },

  /**
   * El servidor confirmó estos jti: salen de la cola y en el historial pasan a "sincronizado".
   * Va en una sola transacción. Si algo falla, la cola queda como estaba y se vuelven a enviar;
   * el backend reconoce el mismo jti como reintento y lo vuelve a confirmar.
   */
  async marcarComoSincronizados(jtisSincronizados: string[]) {
    if (jtisSincronizados.length === 0) return;
    await db.transaction('rw', db.ingresos_pendientes, db.historial, async () => {
      await db.ingresos_pendientes.where('jti').anyOf(jtisSincronizados).delete();
      await db.historial.where('jti').anyOf(jtisSincronizados).modify({ estado: 'sincronizado' });
    });
  },

  /** Historial del dispositivo, del más nuevo al más viejo. */
  async obtenerHistorial(): Promise<HistorialIngreso[]> {
    return await db.historial.orderBy('fecha_ingreso').reverse().toArray();
  },

  // ==========================================
  // INGRESO MANUAL Y ESPONTÁNEO
  // ==========================================
  async registrarIngresoManual(
    dni: string,
    nombre: string,
    acompanantes: number,
    tipoVisita: string,
    montoCobrado = 0
  ): Promise<string> {
    // El id se genera una sola vez acá y queda guardado, así los reintentos mandan siempre el mismo
    const jti = generarJti('manual');
  
    const payloadManual = {
      dni,
      nombre,
      tipo_ingreso: 'MANUAL',
      tipo_visita: tipoVisita, // lo que elige el guardia en el formulario
      cantidad_personas: acompanantes + 1,
      monto_cobrado: Math.round(montoCobrado * 100) / 100,
      typ: 'manual'
    };
  
    await this.registrarIngresoOffline(jti, payloadManual);
    // Es el "ID local" que ve el guardia en la confirmación
    return jti;
  },

  // ==========================================
  // LISTA DE REVOCACIÓN (BLACKLIST)
  // ==========================================
  async agregarABlacklist(idAEliminar: string): Promise<void> {
    await db.blacklist.put({
      id: idAEliminar,
      fechaCancelacion: new Date().toISOString()
    });
  },

  /**
   * Reemplaza la lista local por la que mandó el servidor, en una sola transacción:
   * o queda la lista nueva completa o sigue la anterior. Así las reservas que ya pasaron
   * (o que dejaron de estar canceladas) se van solas en la siguiente sincronización.
   */
  async reemplazarBlacklist(ids: string[]): Promise<void> {
    const fechaDescarga = new Date().toISOString();
    await db.transaction('rw', db.blacklist, async () => {
      await db.blacklist.clear();
      await db.blacklist.bulkPut(ids.map((id) => ({ id, fechaCancelacion: fechaDescarga })));
    });
  },

  async verificarAccesoRevocado(idEscaneado: string): Promise<boolean> {
    const registro = await db.blacklist.get(idEscaneado);
    return registro !== undefined; 
  }
};