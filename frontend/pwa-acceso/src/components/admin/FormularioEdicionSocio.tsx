import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  cambiosEdicion,
  formularioEdicion,
  validarEdicion,
  type EdicionFormulario,
  type ErroresEdicion,
  type Socio,
} from '@/lib/socios';
import { limpiarNombre, soloDigitos } from '@/lib/validaciones';

interface Props {
  socio: Socio;
  /** Recibe solo los campos que cambiaron. Si falla, lanza el error con el mensaje para mostrar. */
  onGuardar: (cambios: Partial<EdicionFormulario>) => Promise<void>;
  onCancelar: () => void;
}

function MensajeError({ texto }: { texto?: string }) {
  return texto ? (
    <p role="alert" className="mt-1 text-sm text-red-600">
      {texto}
    </p>
  ) : null;
}

/** Corrección de nombre, DNI y email de un socio. */
export default function FormularioEdicionSocio({
  socio,
  onGuardar,
  onCancelar,
}: Props) {
  const [form, setForm] = useState<EdicionFormulario>(() =>
    formularioEdicion(socio)
  );
  const [errores, setErrores] = useState<ErroresEdicion>({});
  const [errorServidor, setErrorServidor] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cambiar = (campo: keyof EdicionFormulario, valor: string) =>
    setForm((anterior) => ({ ...anterior, [campo]: valor }));

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    const erroresForm = validarEdicion(form);
    setErrores(erroresForm);
    setErrorServidor('');
    if (Object.keys(erroresForm).length > 0) return;

    const cambios = cambiosEdicion(socio, form);
    if (Object.keys(cambios).length === 0) {
      onCancelar();
      return;
    }

    setGuardando(true);
    try {
      await onGuardar(cambios);
    } catch (error) {
      setErrorServidor(
        error instanceof Error
          ? error.message
          : 'No se pudieron guardar los cambios.'
      );
      setGuardando(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Editar socio</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={guardar}
          noValidate
          className="grid gap-4 sm:grid-cols-3"
        >
          <div>
            <Label htmlFor="editar-nombre">Nombre</Label>
            <Input
              id="editar-nombre"
              className="mt-1"
              value={form.nombre}
              maxLength={100}
              aria-invalid={!!errores.nombre}
              onChange={(e) => cambiar('nombre', limpiarNombre(e.target.value))}
            />
            <MensajeError texto={errores.nombre} />
          </div>

          <div>
            <Label htmlFor="editar-dni">DNI</Label>
            <Input
              id="editar-dni"
              className="mt-1"
              inputMode="numeric"
              value={form.dni}
              maxLength={8}
              aria-invalid={!!errores.dni}
              onChange={(e) => cambiar('dni', soloDigitos(e.target.value))}
            />
            <MensajeError texto={errores.dni} />
          </div>

          <div>
            <Label htmlFor="editar-email">Email</Label>
            <Input
              id="editar-email"
              className="mt-1"
              type="email"
              value={form.email}
              maxLength={254}
              aria-invalid={!!errores.email}
              onChange={(e) => cambiar('email', e.target.value)}
            />
            <MensajeError texto={errores.email} />
          </div>

          {errorServidor && (
            <p role="alert" className="text-sm text-red-600 sm:col-span-3">
              {errorServidor}
            </p>
          )}

          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
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
