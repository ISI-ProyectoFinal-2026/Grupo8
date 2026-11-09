import { CalendarPlus, Pencil, RotateCcw, UserX } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Socio } from '@/lib/socios';

interface Props {
  socio: Socio;
  /** Mientras hay una operación en curso, los botones quedan deshabilitados. */
  ocupado: boolean;
  onEditar: () => void;
  onRenovar: () => void;
  onDarDeBaja: () => Promise<void>;
  onReactivar: () => void;
}

/**
 * Acciones de una fila del padrón. La baja no se aplica con un solo clic:
 * primero se muestra qué implica y se pide confirmarla.
 */
export default function AccionesSocio({
  socio,
  ocupado,
  onEditar,
  onRenovar,
  onDarDeBaja,
  onReactivar,
}: Props) {
  const [confirmandoBaja, setConfirmandoBaja] = useState(false);

  if (confirmandoBaja) {
    return (
      <div
        role="group"
        aria-label={`Confirmar baja de ${socio.nombre}`}
        className="space-y-2 text-left"
      >
        <p className="max-w-xs text-xs text-zinc-700">
          {`¿Dar de baja a ${socio.nombre}? No va a poder iniciar sesión ni validar como socio. Sus reservas se conservan.`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={ocupado}
            onClick={() =>
              void onDarDeBaja().finally(() => setConfirmandoBaja(false))
            }
          >
            {ocupado ? 'Dando de baja…' : 'Confirmar baja'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={ocupado}
            onClick={() => setConfirmandoBaja(false)}
          >
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={ocupado}
        aria-label={`Editar ${socio.nombre}`}
        onClick={onEditar}
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar
      </Button>
      {socio.activo ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={ocupado}
            aria-label={`Renovar ${socio.nombre}`}
            onClick={onRenovar}
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Renovar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={ocupado}
            aria-label={`Dar de baja a ${socio.nombre}`}
            onClick={() => setConfirmandoBaja(true)}
          >
            <UserX className="h-3.5 w-3.5" />
            Dar de baja
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={ocupado}
          aria-label={`Reactivar ${socio.nombre}`}
          onClick={onReactivar}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reactivar
        </Button>
      )}
    </div>
  );
}
