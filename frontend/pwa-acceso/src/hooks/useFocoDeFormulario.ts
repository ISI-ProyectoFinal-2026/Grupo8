import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Foco de los formularios que se abren dentro de la misma pantalla del panel
 * (alta, edición, renovación). Sub-issue 27.3.
 *
 * Sin esto, quien usa teclado aprieta "Editar" en una fila, el formulario aparece arriba de
 * todo y el foco queda en la tabla. Al cancelar o guardar, el botón que tenía el foco
 * desaparece y el foco se pierde.
 */

const CAMPOS_ENFOCABLES =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';

/**
 * Se usa como `ref` del `<form>`: al aparecer, el foco va a su primer campo habilitado.
 * Es una función fija (no cambia entre renders), así que React la llama solo al montar.
 */
export function enfocarPrimerCampo(formulario: HTMLFormElement | null): void {
  formulario?.querySelector<HTMLElement>(CAMPOS_ENFOCABLES)?.focus();
}

/**
 * Recuerda qué botón abrió el formulario para volver ahí al cancelar.
 * Si ese botón ya no existe (por ejemplo, "Nuevo socio" se oculta mientras el formulario
 * está abierto y vuelve a dibujarse), el foco va a `respaldo`.
 */
export function useVolverAlAbridor() {
  const abridor = useRef<HTMLElement | null>(null);

  const recordar = useCallback(() => {
    abridor.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }, []);

  const volver = useCallback((respaldo?: RefObject<HTMLElement | null>) => {
    // Espera a que React dibuje la pantalla sin el formulario
    setTimeout(() => {
      const destino = abridor.current?.isConnected
        ? abridor.current
        : respaldo?.current;
      destino?.focus();
      abridor.current = null;
    }, 0);
  }, []);

  return { recordar, volver };
}

/**
 * El aviso de resultado ("Socio creado.") recibe el foco cuando aparece, pero solo si el foco
 * se perdió: después de guardar, el formulario y su botón ya no están y el foco queda en la
 * nada. Si el botón usado sigue en pantalla (por ejemplo, "Desactivar"), el foco no se mueve
 * y el aviso igual se anuncia por su role="status". El elemento necesita tabIndex={-1}.
 */
export function useEnfocarAviso<T extends HTMLElement>(aviso: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const focoPerdido =
      !document.activeElement || document.activeElement === document.body;
    if (aviso && focoPerdido) ref.current?.focus();
  }, [aviso]);
  return ref;
}
