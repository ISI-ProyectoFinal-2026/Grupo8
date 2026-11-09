import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatearFecha } from '@/lib/fechas';
import {
  fechaRenovacionSugerida,
  validarRenovacion,
  type Socio,
} from '@/lib/socios';
import { hoyISO } from '@/lib/validaciones';

interface Props {
  socio: Socio;
  /** Si falla, lanza el error con el mensaje para mostrar. */
  onRenovar: (membresiaVence: string) => Promise<void>;
  onCancelar: () => void;
}

/** Nueva fecha de vencimiento. Propone un año más, que el administrador puede cambiar. */
export default function FormularioRenovacionSocio({
  socio,
  onRenovar,
  onCancelar,
}: Props) {
  const [fecha, setFecha] = useState(() => fechaRenovacionSugerida(socio));
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const renovar = async (evento: FormEvent) => {
    evento.preventDefault();
    const errorFecha = validarRenovacion(fecha);
    setError(errorFecha ?? '');
    if (errorFecha) return;

    setGuardando(true);
    try {
      await onRenovar(fecha);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'No se pudo renovar la membresía.'
      );
      setGuardando(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Renovar membresía de {socio.nombre}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={renovar} noValidate className="space-y-4">
          <p className="text-sm text-zinc-600">
            {socio.membresia_vence
              ? `Vencimiento actual: ${formatearFecha(socio.membresia_vence)}.`
              : 'Todavía no tiene una fecha de vencimiento cargada.'}
          </p>
          <div className="max-w-xs">
            <Label htmlFor="renovar-vence">Nuevo vencimiento</Label>
            <Input
              id="renovar-vence"
              className="mt-1"
              type="date"
              min={hoyISO()}
              value={fecha}
              aria-invalid={!!error}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={guardando}>
              {guardando ? 'Renovando…' : 'Renovar'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={guardando}
              onClick={onCancelar}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
