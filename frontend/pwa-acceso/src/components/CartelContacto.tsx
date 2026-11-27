import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * Aviso para quien espera un correo que no llega (el enlace para cancelar o el QR): lleva a la
 * pantalla Contacto del camping. El texto va completo y el enlace dice a dónde lleva, así no se
 * depende del color ni de un ícono.
 */
export function CartelContacto({ className }: { className?: string }) {
  return (
    <aside
      aria-labelledby="cartel-contacto-texto"
      className={cn(
        'rounded-lg border border-bosque-200 bg-bosque-50 px-4 py-3 text-left text-base text-tierra-900',
        className
      )}
    >
      <p id="cartel-contacto-texto">
        <span className="font-semibold">¿No te llegó el mail?</span>{' '}
        <Link
          to="/contacto"
          className="inline-block rounded-sm py-1 font-semibold text-bosque-700 underline underline-offset-2 hover:text-bosque-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Contactanos
          <span className="sr-only"> (abre la pantalla de contacto del camping)</span>
        </Link>
      </p>
    </aside>
  );
}
