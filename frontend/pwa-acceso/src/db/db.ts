import Dexie, { type EntityTable } from 'dexie';

export interface Configuracion {
  clave: string;
  valor: any;
}

export interface IngresoPendiente {
  id?: number;
  jti: string;          // Identificador único del QR (evita dobles escaneos offline)
  qr_payload: any;      // Los datos decodificados del visitante
  fecha_escaneo: Date;
  sincronizado: boolean; // Bandera para saber qué mandar a FastAPI luego
}

export interface HistorialIngreso {
  id?: number;
  reserva_id: number;
  fecha_ingreso: Date;
  estado: string;
}

// Reservas canceladas que la app del guardia rechaza sin conexión
export interface BlacklistEntry {
  id: string;             // ID de la reserva o usuario revocado
  fechaCancelacion: string; // Fecha en la que se bloqueó
}

class SgicDatabase extends Dexie {
  configuracion!: EntityTable<Configuracion, 'clave'>;
  ingresos_pendientes!: EntityTable<IngresoPendiente, 'id'>;
  historial!: EntityTable<HistorialIngreso, 'id'>;
  
  blacklist!: EntityTable<BlacklistEntry, 'id'>;

  constructor() {
    super('SgicOfflineDB');
    
    // v3: la app guardaba una capacidad fija de 500 en cada arranque. Ese valor era inventado:
    // se borra y se vuelve a descargar del servidor.
    this.version(3)
      .stores({
        configuracion: 'clave',
        ingresos_pendientes: '++id, jti, sincronizado',
        historial: '++id, reserva_id, fecha_ingreso',
        blacklist: 'id'
      })
      .upgrade((tx) => tx.table('configuracion').delete('capacidad_maxima'));
  }
}

// Una sola instancia para toda la app
export const db = new SgicDatabase();