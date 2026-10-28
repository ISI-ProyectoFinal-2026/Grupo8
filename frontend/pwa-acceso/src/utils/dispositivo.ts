import { dbService } from '../services/dbService';
import { uuidV4 } from './jti';

const CLAVE = 'dispositivo_id';
let enCurso: Promise<string> | null = null;

/**
 * Identificador estable de esta PWA. Se genera una vez y se guarda en IndexedDB,
 * junto a la cola de ingresos, para que el backend distinga un reenvío de un QR clonado.
 */
export const obtenerDispositivoId = (): Promise<string> => {
  if (!enCurso) {
    enCurso = (async () => {
      const guardado = await dbService.obtenerConfiguracion(CLAVE);
      if (typeof guardado === 'string' && guardado.length > 0) return guardado;
      const nuevo = `dispositivo-${uuidV4()}`;
      await dbService.guardarConfiguracion(CLAVE, nuevo);
      return nuevo;
    })().catch((error) => {
      enCurso = null; // si falló, el próximo intento vuelve a probar
      throw error;
    });
  }
  return enCurso;
};