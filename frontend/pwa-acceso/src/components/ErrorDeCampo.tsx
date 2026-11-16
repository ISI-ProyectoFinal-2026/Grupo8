import { idDelError } from '@/lib/errorDeCampo';
import { cn } from '@/lib/utils';

interface Props {
  /** id del campo al que pertenece el error. */
  idCampo: string;
  mensaje?: string | null;
  className?: string;
}

/**
 * Mensaje de error debajo de un campo. Se anuncia apenas aparece (role="alert") y el campo
 * lo referencia con `atributosDeError` de lib/errorDeCampo.
 */
export function ErrorDeCampo({ idCampo, mensaje, className }: Props) {
  if (!mensaje) return null;
  return (
    <p
      id={idDelError(idCampo)}
      role="alert"
      className={cn('text-sm text-destructive', className)}
    >
      {mensaje}
    </p>
  );
}
