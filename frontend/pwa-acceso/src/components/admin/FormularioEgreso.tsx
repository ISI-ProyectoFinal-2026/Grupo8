import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import { validarCantidadEgreso } from '@/lib/ocupacion';
import { mensajeDeError, OcupacionApiError, registrarEgreso } from '@/services/ocupacionService';

interface FormularioEgresoProps {
  /** Personas dentro según el monitor; null si todavía no se cargó. */
  personasDentro: number | null;
  /** Se llama después de registrar un egreso, para actualizar el monitor. */
  onRegistrado: () => Promise<void>;
}

export function FormularioEgreso({ personasDentro, onRegistrado }: FormularioEgresoProps) {
  const { token } = useAuth();
  const [cantidad, setCantidad] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setAviso(null);

    const errorValidacion = validarCantidadEgreso(cantidad, personasDentro);
    if (errorValidacion) {
      setError(errorValidacion);
      return;
    }

    const personas = Number(cantidad.trim());
    setError(null);
    setEnviando(true);
    try {
      await registrarEgreso(token, personas);
      setCantidad('');
      setAviso(personas === 1 ? 'Se registró el egreso de 1 persona.' : `Se registró el egreso de ${personas} personas.`);
      await onRegistrado();
    } catch (err) {
      if (err instanceof OcupacionApiError) {
        if (err.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        // La ocupación que se veía estaba desactualizada: se trae la actual
        if (err.status === 409) void onRegistrado();
      }
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registrar egreso</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={enviar} noValidate className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="egreso-cantidad">Personas que salen</Label>
            <Input
              id="egreso-cantidad"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? 'egreso-error' : undefined}
              className="w-40"
            />
          </div>
          <Button type="submit" disabled={enviando}>
            {enviando ? 'Registrando…' : 'Registrar egreso'}
          </Button>
        </form>

        {error && (
          <p id="egreso-error" role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        {aviso && (
          <p role="status" className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            {aviso}
          </p>
        )}
        <p className="mt-3 text-xs text-zinc-500">Se guarda con la fecha y hora del momento en que lo registrás.</p>
      </CardContent>
    </Card>
  );
}