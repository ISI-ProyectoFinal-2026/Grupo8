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
    // Usamos .filter() porque Dexie/IndexedDB no permite indexar booleanos directamente
    return await db.ingresos_pendientes
      .filter((ingreso: any) => ingreso.sincronizado === false)
      .toArray();
  },

  async marcarComoSincronizado(id: number): Promise<void> {
    await db.ingresos_pendientes.update(id, { sincronizado: true });
  },

  async obtenerIngresosPendientes() {
    return await db.ingresos_pendientes
      .filter((ingreso: any) => ingreso.sincronizado === false)
      .toArray();
  },

  async marcarComoSincronizados(jtisSincronizados: string[]) {
    // Puedes borrarlos para ahorrar espacio, o marcarlos como true.
    // Para un MVP, borrarlos es lo más limpio:
    await db.ingresos_pendientes
      .where('jti')
      .anyOf(jtisSincronizados)
      .delete();
  }, // <-- Acá está la coma mágica que agregamos para no romper el objeto

  // ==========================================
  // LISTA DE REVOCACIÓN (BLACKLIST)
  // ==========================================
  
  // Herramienta 1: Guarda un ID en la lista negra (Lapicera)
  async agregarABlacklist(idAEliminar: string): Promise<void> {
    await db.blacklist.put({
      id: idAEliminar,
      fechaCancelacion: new Date().toISOString()
    });
  },

  // Herramienta 2: Verifica si el ID está bloqueado antes de abrir la puerta (Lupa)
  // Criterio de Aceptación: Modificación del flujo de validación offline
  async verificarAccesoRevocado(idEscaneado: string): Promise<boolean> {
    const registro = await db.blacklist.get(idEscaneado);
    return registro !== undefined; // Si encuentra datos, devuelve true
  }

};