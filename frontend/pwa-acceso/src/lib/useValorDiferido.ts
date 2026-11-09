import { useEffect, useState } from 'react';

/**
 * Devuelve el valor recién cuando deja de cambiar durante `demoraMs`.
 * Sirve para buscar mientras se escribe sin pedirle al backend una lista por cada tecla.
 */
export function useValorDiferido<T>(valor: T, demoraMs: number): T {
  const [diferido, setDiferido] = useState(valor);

  useEffect(() => {
    const espera = window.setTimeout(() => setDiferido(valor), demoraMs);
    return () => window.clearTimeout(espera);
  }, [valor, demoraMs]);

  return diferido;
}
