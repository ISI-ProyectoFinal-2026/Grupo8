import { openDB } from 'idb';

// Definimos el nombre de nuestra base de datos local y su versión
const DB_NAME = 'camping_offline_db';
const DB_VERSION = 1;

export const initDB = async () => {
  // openDB crea la base de datos o la abre si ya existe en el navegador del guardia
  const db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Este bloque "upgrade" se ejecuta la primerísima vez que se crea la BD
      
      // DoD 7.1: "Creación del store blacklist en IndexedDB"
      // Si no existe la "libreta negra", la creamos. Le decimos que busque por 'id'.
      if (!db.objectStoreNames.contains('blacklist')) {
        db.createObjectStore('blacklist', { keyPath: 'id' });
        console.log('¡Éxito! Se creó el almacén local: blacklist');
      }
    },
  });
  return db;
};


// Herramienta 1: La lapicera
// Esta función anota un ID cancelado en la base de datos local. 
// La vamos a usar más adelante para descargar la lista desde tu backend cuando haya internet.
export const addToBlacklist = async (idAEliminar: string) => {
  const db = await initDB();
  // Usamos 'put' para guardar el ID. Le agregamos la fecha actual para tener un registro de cuándo se canceló.
  await db.put('blacklist', { 
    id: idAEliminar, 
    fechaCancelacion: new Date().toISOString() 
  });
};

// Herramienta 2: La lupa (El corazón de tu Issue 7.1)
// Esta es la función que va a usar el escáner QR antes de abrirle la puerta al visitante.
export const isIdBlacklisted = async (idEscaneado: string) => {
  const db = await initDB();
  
  // Le decimos a la base de datos: "Buscame este ID en la blacklist"
  const registroEncontrado = await db.get('blacklist', idEscaneado);
  
  // Si registroEncontrado tiene datos, significa que el ID ESTÁ en la lista negra (devuelve true).
  // Si es undefined, significa que el visitante está limpio y puede pasar (devuelve false).
  return registroEncontrado !== undefined;
};