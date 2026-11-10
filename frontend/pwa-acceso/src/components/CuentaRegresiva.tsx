import { formatearRestante, msRestantes } from '@/lib/reservaPendiente';
import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Fecha de vencimiento en ISO, con zona horaria. */
  vencimiento: string;
  /** Se llama una sola vez, cuando el tiempo llega a cero. */
  onVencido?: () => void;
  className?: string;
}

/**
 * Muestra "mm:ss" hasta el vencimiento. El tiempo restante se recalcula con el reloj en cada
 * tick (no se descuenta de a un segundo), así no se atrasa si la pestaña queda en segundo plano.
 */
export function CuentaRegresiva({ vencimiento, onVencido, className }: Props) {
  const [restante, setRestante] = useState(() => msRestantes(vencimiento));
  const avisado = useRef(false);
  const onVencidoRef = useRef(onVencido);
  onVencidoRef.current = onVencido;

  useEffect(() => {
    avisado.current = false;
    const actualizar = () => {
      const ms = msRestantes(vencimiento);
      setRestante(ms);
      if (ms === 0 && !avisado.current) {
        avisado.current = true;
        onVencidoRef.current?.();
      }
    };
    actualizar();
    const intervalo = setInterval(actualizar, 1000);
    return () => clearInterval(intervalo);
  }, [vencimiento]);

  return (
    <span role="timer" aria-live="off" className={className}>
      {formatearRestante(restante)}
    </span>
  );
}
