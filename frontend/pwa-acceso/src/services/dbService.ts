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

  // ==========================================
  // STORES: INGRESOS PENDIENTES (OFFLINE)
  // ==========================================
  async registrarIngresoOffline(jti: string, payload: any): Promise<number> {
    // Lógica de seguridad: Evitar que el mismo QR pase dos veces en modo offline
    const existe = await db.ingresos_pendientes.where('jti').equals(jti).first();
    if (existe) {
      throw new Error('QR_DUPLICADO: Este visitante ya ingresó recientemente.');
    }

    // Le decimos explícitamente a TypeScript que esto retornará el ID numérico
    return await db.ingresos_pendientes.add({
      jti,
      qr_payload: payload,
      fecha_escaneo: new Date(),
      sincronizado: false
    }) as number;
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