import { formatearMonto } from '@/lib/cotizacion';
import { formatearFecha } from '@/lib/fechas';
import type { CondicionesCancelacion } from '@/lib/misReservas';

function textoDelPlazo(dias: number): string {
  if (dias === 0) return 'hasta el mismo día del ingreso';
  return `${dias} ${dias === 1 ? 'día' : 'días'} antes del ingreso`;
}

/**
 * Condiciones de una cancelación permitida: hasta cuándo, cuánto se devuelve y la pregunta de
 * confirmación. Lo usan el diálogo de Mis reservas y la pantalla del botón de arrepentimiento.
 */
export function DetalleCondiciones({
  condiciones,
}: {
  condiciones: CondicionesCancelacion;
}) {
  return (
    <div className="space-y-4">
      {condiciones.arrepentimiento && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Estás dentro del plazo de arrepentimiento: se te devuelve el total.
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-tierra-500">Podés cancelar hasta</dt>
        <dd className="font-medium text-tierra-900">
          {/* En el arrepentimiento la fecha no sale de los días configurados */}
          {condiciones.arrepentimiento
            ? formatearFecha(condiciones.fecha_limite)
            : `${formatearFecha(condiciones.fecha_limite)} (${textoDelPlazo(condiciones.dias_minimos)})`}
        </dd>
        <dt className="text-tierra-500">Devolución</dt>
        <dd className="font-medium text-tierra-900">
          {condiciones.porcentaje_devolucion} % de lo que pagaste
        </dd>
        <dt className="text-tierra-500">Monto a devolver</dt>
        <dd className="font-medium text-tierra-900">
          {formatearMonto(condiciones.monto_devolucion)}
        </dd>
      </dl>
      <p className="font-medium text-tierra-900">
        ¿Está seguro que desea cancelar?
      </p>
    </div>
  );
}
