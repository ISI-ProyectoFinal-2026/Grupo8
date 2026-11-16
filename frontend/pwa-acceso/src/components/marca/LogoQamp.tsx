import { cn } from '@/lib/utils';

interface LogoQampProps {
  /** Tamaño del ícono en px. */
  tamanio?: number;
  /** Muestra el nombre "Qamp" al lado del ícono. */
  conNombre?: boolean;
  className?: string;
}

/**
 * Logo de Qamp para el panel y la app del guardia: una carpa dentro de una Q.
 * Toma el color del texto que lo rodea, así sirve sobre fondo claro y sobre la barra lateral.
 */
export function LogoQamp({ tamanio = 28, conNombre = true, className }: LogoQampProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg
        width={tamanio}
        height={tamanio}
        viewBox="0 0 40 40"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="19" cy="19" r="15" />
        <path d="M11.5 25.5 L19 12.5 L26.5 25.5 Z" />
        <path d="M17 25.5 L19 21.5 L21 25.5" />
        <path d="M29.5 29.5 L35.5 35.5" />
      </svg>
      {conNombre && <span className="text-xl font-semibold">Qamp</span>}
    </span>
  );
}
