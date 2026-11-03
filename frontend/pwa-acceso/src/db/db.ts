import Dexie, { type EntityTable } from 'dexie';

// 1. Definimos las interfaces de TypeScript (Modelos de datos)
export interface Configuracion {
  clave: string;
  valor: any;
}

export interface IngresoPendiente {
  id?: number;          // Autoincremental
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

// Interfaz para la Blacklist (DoD Issue 7.1)
export interface BlacklistEntry {
  id: string;             // ID de la reserva o usuario revocado
  fechaCancelacion: string; // Fecha en la que se bloqueó
}

// 2. Extendemos la clase de Dexie
class SgicDatabase extends Dexie {
  configuracion!: EntityTable<Configuracion, 'clave'>;
  ingresos_pendientes!: EntityTable<IngresoPendiente, 'id'>;
  historial!: EntityTable<HistorialIngreso, 'id'>;
  
  // NUEVO: Declaramos la tabla blacklist a Dexie
  blacklist!: EntityTable<BlacklistEntry, 'id'>;

  constructor() {
    // Nombre de la base de datos local
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

// Exportamos una única instancia (Patrón Singleton)
export const db = new SgicDatabase();