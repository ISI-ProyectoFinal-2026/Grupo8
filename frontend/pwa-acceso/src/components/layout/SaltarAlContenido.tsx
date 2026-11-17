import type { RefObject } from 'react';

interface Props {
  /** Contenedor del contenido principal; necesita id y tabIndex={-1}. */
  destino: RefObject<HTMLElement | null>;
  idDestino: string;
}

/**
 * Primer elemento al usar Tab: salta el encabezado o el menú y lleva directo al contenido
 * (WCAG 2.4.1). Solo se ve cuando tiene el foco.
 */
export function SaltarAlContenido({ destino, idDestino }: Props) {
  return (
    <a
      href={`#${idDestino}`}
      // Se mueve el foco a mano para no sumar "#contenido" a la dirección ni al historial
      onClick={(e) => {
        e.preventDefault();
        destino.current?.focus();
      }}
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:font-medium focus:text-foreground focus:shadow-md"
    >
      Saltar al contenido
    </a>
  );
}
