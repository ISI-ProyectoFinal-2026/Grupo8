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

// 2. Extendemos la clase de Dexie
class SgicDatabase extends Dexie {
  configuracion!: EntityTable<Configuracion, 'clave'>;
  ingresos_pendientes!: EntityTable<IngresoPendiente, 'id'>;
  historial!: EntityTable<HistorialIngreso, 'id'>;

  constructor() {
    // Nombre de la base de datos local
    super('SgicOfflineDB');
    
    // 3. Definimos el esquema
    // OJO: En IndexedDB solo declaras la Primary Key y los campos por los que vas a querer filtrar/buscar.
    this.version(1).stores({
      configuracion: 'clave', // 'clave' es la Primary Key
      ingresos_pendientes: '++id, jti, sincronizado', // ++id significa autoincremental
      historial: '++id, reserva_id, fecha_ingreso'
    });
  }
}

// Exportamos una única instancia (Patrón Singleton)
export const db = new SgicDatabase();