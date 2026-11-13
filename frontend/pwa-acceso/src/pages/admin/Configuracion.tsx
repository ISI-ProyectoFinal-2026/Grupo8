import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import {
  bufferEnPersonas,
  formularioDesdeConfiguracion,
  guardarConfiguracion,
  obtenerConfiguracion,
  parsearEntero,
  validarBuffer,
  validarCapacidad,
  validarConfiguracion,
  validarDiasCancelacion,
  validarPorcentajeDevolucion,
  type ConfiguracionFormulario,
  type ErroresConfiguracion,
} from '@/lib/configuracion';
import { ErrorApi } from '@/lib/descuentos';

function MensajeError({ texto }: { texto?: string }) {
  return texto ? (
    <p role="alert" className="mt-1 text-sm text-red-600">
      {texto}
    </p>
  ) : null;
}

const formularioVacio: ConfiguracionFormulario = {
  capacidad_total: '',
  porcentaje_buffer_offline: '',
  max_personas_por_reserva: '',
  dias_cancelacion: '',
  porcentaje_devolucion: '',
};

/** Frase que resume las reglas de cancelación tal como las va a ver el socio. */
function resumenCancelacion(dias: number, porcentaje: number): string {
  const plazo =
    dias === 0
      ? 'hasta el mismo día del ingreso'
      : `hasta ${dias} ${dias === 1 ? 'día' : 'días'} antes del ingreso`;
  return `Los socios pueden cancelar ${plazo} y se les devuelve el ${porcentaje} % de lo que pagaron.`;
}

export default function Configuracion() {
  const { token } = useAuth();
  const [form, setForm] = useState<ConfiguracionFormulario>(formularioVacio);
  const [recomendado, setRecomendado] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [errores, setErrores] = useState<ErroresConfiguracion>({});
  const [errorServidor, setErrorServidor] = useState('');
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Una sesión vencida cierra la sesión desde el AuthContext
  const manejarError = useCallback((error: unknown): string => {
    if (error instanceof ErrorApi) {
      if (error.status === 401)
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      return error.message;
    }
    return 'Ocurrió un error inesperado. Intentá de nuevo.';
  }, []);

  const cargar = useCallback(async () => {
    if (!token) return;
    setCargando(true);
    setErrorCarga('');
    try {
      const config = await obtenerConfiguracion(token);
      setForm(formularioDesdeConfiguracion(config));
      setRecomendado(config.porcentaje_buffer_recomendado);
    } catch (error) {
      setErrorCarga(manejarError(error));
    } finally {
      setCargando(false);
    }
  }, [token, manejarError]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cambiar = (campo: keyof ConfiguracionFormulario, valor: string) => {
    setForm((anterior) => ({ ...anterior, [campo]: valor }));
    setAviso('');
  };

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!token) return;

    const erroresForm = validarConfiguracion(form);
    setErrores(erroresForm);
    setErrorServidor('');
    setAviso('');
    if (Object.keys(erroresForm).length > 0) return;

    setGuardando(true);
    try {
      const guardada = await guardarConfiguracion(token, form);
      setForm(formularioDesdeConfiguracion(guardada));
      setAviso('Configuración guardada.');
    } catch (error) {
      setErrorServidor(manejarError(error));
    } finally {
      setGuardando(false);
    }
  };

  // Resumen en vivo: solo si cupo y buffer son válidos
  const capacidad = parsearEntero(form.capacidad_total);
  const porcentaje = parsearEntero(form.porcentaje_buffer_offline);
  const valoresValidos =
    capacidad !== null &&
    porcentaje !== null &&
    !validarCapacidad(form.capacidad_total) &&
    !validarBuffer(form.porcentaje_buffer_offline);
  const lugaresPuerta = valoresValidos
    ? bufferEnPersonas(capacidad, porcentaje)
    : null;

  // Resumen de cancelación: solo si los dos valores son válidos
  const reglasValidas =
    !validarDiasCancelacion(form.dias_cancelacion) &&
    !validarPorcentajeDevolucion(form.porcentaje_devolucion);
  const textoCancelacion = reglasValidas
    ? resumenCancelacion(
        Number(form.dias_cancelacion.trim()),
        Number(form.porcentaje_devolucion.trim())
      )
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">
          Configuración del camping
        </h1>
        <p className="mt-1 text-zinc-600">
          Definí cuántas personas entran al camping, qué parte del cupo se
          guarda para los ingresos en la puerta, cuántas personas puede tener
          cada reserva y las reglas para cancelar una reserva.
        </p>
      </div>

      {aviso && (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          {aviso}
        </p>
      )}

      {cargando || errorCarga ? (
        <Card>
          <CardHeader>
            <CardTitle>Cupo y reservas</CardTitle>
          </CardHeader>
          <CardContent>
            {cargando ? (
              <p className="text-zinc-600">Cargando configuración…</p>
            ) : (
              <div className="space-y-3">
                <p role="alert" className="text-red-700">
                  {errorCarga}
                </p>
                <Button variant="outline" onClick={() => void cargar()}>
                  Reintentar
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        // Un solo formulario para las dos tarjetas: se guardan todos los valores juntos
        <form onSubmit={guardar} noValidate className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Cupo y reservas</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="config-capacidad">
                  Cupo máximo del camping (personas)
                </Label>
                <Input
                  id="config-capacidad"
                  className="mt-1"
                  inputMode="numeric"
                  value={form.capacidad_total}
                  aria-invalid={!!errores.capacidad_total}
                  onChange={(e) => cambiar('capacidad_total', e.target.value)}
                />
                <MensajeError texto={errores.capacidad_total} />
              </div>

              <div>
                <Label htmlFor="config-buffer">Buffer offline (%)</Label>
                <Input
                  id="config-buffer"
                  className="mt-1"
                  inputMode="numeric"
                  placeholder={
                    recomendado !== null ? String(recomendado) : undefined
                  }
                  value={form.porcentaje_buffer_offline}
                  aria-invalid={!!errores.porcentaje_buffer_offline}
                  aria-describedby="config-buffer-ayuda"
                  onChange={(e) =>
                    cambiar('porcentaje_buffer_offline', e.target.value)
                  }
                />
                <MensajeError texto={errores.porcentaje_buffer_offline} />
                <p
                  id="config-buffer-ayuda"
                  className="mt-1 text-xs text-zinc-500"
                >
                  Parte del cupo que no se vende online y queda para los
                  ingresos que registra el guardia, aunque no haya internet.
                  {recomendado !== null && ` Recomendado: ${recomendado} %.`}
                </p>
                {recomendado !== null &&
                  form.porcentaje_buffer_offline.trim() !==
                    String(recomendado) && (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() =>
                        cambiar(
                          'porcentaje_buffer_offline',
                          String(recomendado)
                        )
                      }
                    >
                      Usar el recomendado ({recomendado} %)
                    </Button>
                  )}
              </div>

              <div>
                <Label htmlFor="config-maximo">
                  Máximo de personas por reserva
                </Label>
                <Input
                  id="config-maximo"
                  className="mt-1"
                  inputMode="numeric"
                  value={form.max_personas_por_reserva}
                  aria-invalid={!!errores.max_personas_por_reserva}
                  onChange={(e) =>
                    cambiar('max_personas_por_reserva', e.target.value)
                  }
                />
                <MensajeError texto={errores.max_personas_por_reserva} />
              </div>

              {lugaresPuerta !== null && capacidad !== null && (
                <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700 sm:col-span-3">
                  Se venden online <strong>{capacidad - lugaresPuerta}</strong>{' '}
                  lugares y <strong>{lugaresPuerta}</strong> quedan para la
                  puerta.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cancelaciones</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="config-dias-cancelacion">
                  Cancelar hasta (días antes del ingreso)
                </Label>
                <Input
                  id="config-dias-cancelacion"
                  className="mt-1"
                  inputMode="numeric"
                  value={form.dias_cancelacion}
                  aria-invalid={!!errores.dias_cancelacion}
                  aria-describedby="config-dias-cancelacion-ayuda"
                  onChange={(e) => cambiar('dias_cancelacion', e.target.value)}
                />
                <MensajeError texto={errores.dias_cancelacion} />
                <p
                  id="config-dias-cancelacion-ayuda"
                  className="mt-1 text-xs text-zinc-500"
                >
                  Con 0, se puede cancelar hasta el mismo día del ingreso.
                </p>
              </div>

              <div>
                <Label htmlFor="config-devolucion">Devolución (%)</Label>
                <Input
                  id="config-devolucion"
                  className="mt-1"
                  inputMode="numeric"
                  value={form.porcentaje_devolucion}
                  aria-invalid={!!errores.porcentaje_devolucion}
                  aria-describedby="config-devolucion-ayuda"
                  onChange={(e) =>
                    cambiar('porcentaje_devolucion', e.target.value)
                  }
                />
                <MensajeError texto={errores.porcentaje_devolucion} />
                <p
                  id="config-devolucion-ayuda"
                  className="mt-1 text-xs text-zinc-500"
                >
                  Parte de lo pagado que se devuelve por Mercado Pago al
                  cancelar.
                </p>
              </div>

              {textoCancelacion && (
                <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700 sm:col-span-2">
                  {textoCancelacion}
                </p>
              )}
            </CardContent>
          </Card>

          {errorServidor && (
            <p role="alert" className="text-sm text-red-600">
              {errorServidor}
            </p>
          )}

          <Button type="submit" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Button>
        </form>
      )}
    </div>
  );
}
