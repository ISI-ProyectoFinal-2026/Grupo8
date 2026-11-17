/**
 * Errores de formulario accesibles (Sub-issue 27.2).
 *
 * Cada mensaje de error tiene un id derivado del id del campo. El campo lo apunta con
 * `aria-describedby` y se marca con `aria-invalid`, así el lector de pantalla lee el error
 * al llegar al campo, no solo cuando aparece.
 */

/** id del mensaje de error de un campo: "fecha" → "fecha-error". */
export const idDelError = (idCampo: string): string => `${idCampo}-error`;

interface AtributosDeError {
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
}

/**
 * Atributos que se le pasan al campo. Sin error no agrega nada.
 * `error` es el mensaje, o `true` cuando el mensaje lo dibuja otro componente con el mismo id.
 * `idAyuda` es el texto de ayuda del campo, si tiene: se lee siempre, y el error después.
 */
export function atributosDeError(
  idCampo: string,
  error?: string | boolean | null,
  idAyuda?: string
): AtributosDeError {
  const descripciones = [
    idAyuda,
    error ? idDelError(idCampo) : undefined,
  ].filter(Boolean);
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby':
      descripciones.length > 0 ? descripciones.join(' ') : undefined,
  };
}

/**
 * Lleva el foco al primer campo con error, aunque esté fuera de pantalla.
 * Espera al próximo ciclo para que React ya haya marcado los campos con aria-invalid.
 */
export function enfocarPrimerError(): void {
  setTimeout(() => {
    const campo = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!campo) return;
    campo.focus({ preventScroll: true });
    campo.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, 0);
}
