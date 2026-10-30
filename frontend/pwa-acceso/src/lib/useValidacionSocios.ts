import { useCallback, useRef, useState } from 'react';
import { validarSocio, type MotivoSocio } from '@/lib/validacionSocio';

export type Verificacion =
  | { estado: 'verificando' }
  | { estado: 'ok'; nombre: string }
  | { estado: 'rechazado'; motivo: MotivoSocio | null }
  | { estado: 'error' };

/**
 * Verifica DNI de socios contra el backend y guarda el resultado por DNI.
 * Solo se recuerdan las verificaciones correctas (y las que están en curso): un rechazo o un
 * error de red se vuelven a consultar, así un socio que regulariza su cuota no queda bloqueado.
 */
export function useValidacionSocios() {
  const [resultados, setResultados] = useState<Record<string, Verificacion>>({});
  const recordadas = useRef(new Map<string, Promise<Verificacion>>());

  const verificar = useCallback((dni: string): Promise<Verificacion> => {
    const existente = recordadas.current.get(dni);
    if (existente) return existente;

    setResultados((previos) => ({ ...previos, [dni]: { estado: 'verificando' } }));
    const promesa = validarSocio(dni)
      .then(
        (respuesta): Verificacion =>
          respuesta.valido
            ? { estado: 'ok', nombre: respuesta.nombre ?? '' }
            : { estado: 'rechazado', motivo: respuesta.motivo }
      )
      .catch((): Verificacion => ({ estado: 'error' }))
      .then((resultado) => {
        if (resultado.estado !== 'ok') recordadas.current.delete(dni);
        setResultados((previos) => ({ ...previos, [dni]: resultado }));
        return resultado;
      });
    recordadas.current.set(dni, promesa);
    return promesa;
  }, []);

  return { resultados, verificar };
}