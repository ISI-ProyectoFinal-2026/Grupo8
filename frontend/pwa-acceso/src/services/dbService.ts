import { db } from '../db/db';

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

  async obtenerCapacidadMaxima(): Promise<number> {
    const capacidad = await db.configuracion.get('capacidad_maxima');
    return capacidad ? parseInt(capacidad.valor, 10) : 500; 
  },

  // ==========================================
  // STORES: INGRESOS PENDIENTES (OFFLINE)
  // ==========================================
  async registrarIngresoOffline(jti: string, payload: any): Promise<number> {
    return await db.transaction('rw', db.ingresos_pendientes, db.configuracion, async () => {
      
      const existe = await db.ingresos_pendientes.where('jti').equals(jti).first();
      if (existe) {
        throw new Error('QR_DUPLICADO: Este código ya fue escaneado y registrado.');
      }

      const ocupacionActual = await this.obtenerOcupacion();
      const capacidadMaxima = await this.obtenerCapacidadMaxima();
      const nuevasPersonas = payload.cantidad_personas;

      if (ocupacionActual + nuevasPersonas > capacidadMaxima) {
        const lugaresDisponibles = capacidadMaxima - ocupacionActual;
        throw new Error(`CAPACIDAD_EXCEDIDA: Solo quedan ${lugaresDisponibles} lugares disponibles, y el grupo es de ${nuevasPersonas}.`);
      }

      const nuevaOcupacion = ocupacionActual + nuevasPersonas;
      await db.configuracion.put({ clave: 'ocupacion_actual', valor: nuevaOcupacion.toString() });

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

  async marcarComoSincronizados(jtisSincronizados: string[]) {
    await db.ingresos_pendientes
      .where('jti')
      .anyOf(jtisSincronizados)
      .delete();
  },

  // ==========================================
  // INGRESO MANUAL Y ESPONTÁNEO
  // ==========================================
  async registrarIngresoManual(dni: string, nombre: string, acompanantes: number, tipoIngreso: string): Promise<void> {
    const jtiSimulado = `manual-${Date.now()}-${dni}`;
    
    const payloadManual = {
      dni: dni,
      nombre: nombre,
      tipo_ingreso: tipoIngreso,
      cantidad_personas: acompanantes + 1, 
      typ: "manual"
    };

    await this.registrarIngresoOffline(jtiSimulado, payloadManual);
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

  async verificarAccesoRevocado(idEscaneado: string): Promise<boolean> {
    const registro = await db.blacklist.get(idEscaneado);
    return registro !== undefined; 
  }
};