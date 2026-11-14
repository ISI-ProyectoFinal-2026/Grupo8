import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useEsperados } from '@/hooks/useEsperados';
import { textoEsperados } from '@/lib/ocupacion';

/**
 * Personas que se esperan hoy por reservas web pagadas que todavía no ingresaron.
 * Va aparte del monitor de ocupación porque esas personas todavía no están dentro.
 */
export function PersonasEsperadas() {
  const { esperados, estado, error, recargar } = useEsperados();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-zinc-500" aria-hidden="true" />
          Personas esperadas hoy
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {estado === 'cargando' && (
          <p role="status" className="text-zinc-600">
            Cargando personas esperadas…
          </p>
        )}

        {estado === 'error' && (
          <div role="alert" className="space-y-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            <p>{`No se pudo consultar las personas esperadas. ${error ?? ''}`}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void recargar()}>
              Reintentar
            </Button>
          </div>
        )}

        {esperados && (
          <p className="text-2xl font-bold text-zinc-900">
            {textoEsperados(esperados.reservas, esperados.personas)}
          </p>
        )}

        {/* Si ya había datos y falla una actualización, se siguen mostrando los últimos */}
        {esperados && error && (
          <p role="alert" className="text-sm text-red-600">
            {`No se pudo actualizar: ${error}`}
          </p>
        )}

        <p className="text-xs text-zinc-500">
          Reservas web pagadas para hoy que todavía no ingresaron. No se suman a la ocupación
          actual: cuentan recién cuando el guardia escanea el QR.
        </p>
      </CardContent>
    </Card>
  );
}
