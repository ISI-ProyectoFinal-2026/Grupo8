import { db } from '../db/db';

export const dbService = {
  // ==========================================
  // STORES: CONFIGURACIÓN
  // ==========================================
  async guardarConfiguracion(clave: string, valor: any): Promise<void> {
    // .put() actualiza si existe la clave, o la crea si no existe
    await db.configuracion.put({ clave, valor });
  },

  async obtenerConfiguracion(clave: string): Promise<any | undefined> {
    const config = await db.configuracion.get(clave);
    return config?.valor;
  },
  // Nuevos métodos para manejar la ocupación local (DoD Criterio 3)
  async obtenerOcupacion(): Promise<number> {
    const ocupacion = await db.configuracion.get('ocupacion_actual');
    return ocupacion ? parseInt(ocupacion.valor, 10) : 0;
  },

  async obtenerCapacidadMaxima(): Promise<number> {
    // Por ahora lo hardcodeamos para el MVP. 
    // En la sub-issue 6.6, este valor vendrá sincronizado desde el backend.
    const capacidad = await db.configuracion.get('capacidad_maxima');
    return capacidad ? parseInt(capacidad.valor, 10) : 500; 
  },

  // ==========================================
  // STORES: INGRESOS PENDIENTES (OFFLINE) (refactorizado para usar transacciones ACID)
  // ==========================================
  async registrarIngresoOffline(jti: string, payload: any): Promise<number> {
    // db.transaction('rw', ...) bloquea las tablas involucradas para evitar Condiciones de Carrera
    // Si dos guardias escanean en el milisegundo exacto, Dexie los encola ordenadamente.
    return await db.transaction('rw', db.ingresos_pendientes, db.configuracion, async () => {
      
      // 1. Control de duplicados offline
      const existe = await db.ingresos_pendientes.where('jti').equals(jti).first();
      if (existe) {
        throw new Error('QR_DUPLICADO: Este código ya fue escaneado y registrado.');
      }

      // 2. Control de Capacidad Local (DoD Criterio 3)
      const ocupacionActual = await this.obtenerOcupacion();
      const capacidadMaxima = await this.obtenerCapacidadMaxima();
      const nuevasPersonas = payload.cantidad_personas;

      if (ocupacionActual + nuevasPersonas > capacidadMaxima) {
        const lugaresDisponibles = capacidadMaxima - ocupacionActual;
        throw new Error(`CAPACIDAD_EXCEDIDA: Solo quedan ${lugaresDisponibles} lugares disponibles, y el grupo es de ${nuevasPersonas}.`);
      }

      // 3. Actualización de estado local
      const nuevaOcupacion = ocupacionActual + nuevasPersonas;
      await db.configuracion.put({ clave: 'ocupacion_actual', valor: nuevaOcupacion.toString() });

      // 4. Registro final del ingreso (DoD Criterio 1)
      const idGenerado = await db.ingresos_pendientes.add({
        jti,
        qr_payload: payload,
        fecha_escaneo: new Date(),
        sincronizado: false
      });

      return idGenerado as number;
    });
  },

  async obtenerPendientesSincronizacion() {
    // Busca rápidamente todos los registros que aún no se mandaron a FastAPI
    return await db.ingresos_pendientes
      .where('sincronizado')
      .equals('false') // Dexie optimiza esta búsqueda gracias al índice
      .toArray();
  },

  async marcarComoSincronizado(id: number): Promise<void> {
    await db.ingresos_pendientes.update(id, { sincronizado: true });
  }
};