import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DetalleCondiciones } from '@/components/DetalleCondiciones';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ErrorArrepentimiento,
  confirmarArrepentimiento,
  obtenerCondicionesPorEnlace,
  type ResultadoArrepentimiento,
} from '@/lib/arrepentimiento';
import type { CondicionesCancelacion } from '@/lib/misReservas';

const SIN_TOKEN =
  'El enlace no es válido. Pedí uno nuevo desde el botón de arrepentimiento.';

interface ErrorDePantalla {
  mensaje: string;
  /** 401: el enlace venció o no es válido, hay que pedir otro. */
  enlace: boolean;
}

function aError(e: unknown, porDefecto: string): ErrorDePantalla {
  if (e instanceof ErrorArrepentimiento) {
    return { mensaje: e.message, enlace: e.status === 401 };
  }
  return { mensaje: porDefecto, enlace: false };
}

/**
 * Pantalla del enlace que llega por correo (/cancelar-reserva?token=...): muestra las condiciones
 * de esa reserva y permite confirmar la cancelación, sin iniciar sesión.
 */
export default function CancelarReserva() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [condiciones, setCondiciones] = useState<CondicionesCancelacion | null>(null);
  const [cargando, setCargando] = useState(Boolean(token));
  const [errorCarga, setErrorCarga] = useState<ErrorDePantalla | null>(
    token ? null : { mensaje: SIN_TOKEN, enlace: true }
  );
  const [confirmando, setConfirmando] = useState(false);
  const [errorConfirmacion, setErrorConfirmacion] = useState<ErrorDePantalla | null>(null);
  const [resultado, setResultado] = useState<ResultadoArrepentimiento | null>(null);

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setCargando(true);
      setErrorCarga(null);
      try {
        setCondiciones(await obtenerCondicionesPorEnlace(token, signal));
      } catch (e) {
        if (signal?.aborted) return;
        setErrorCarga(
          aError(e, 'No pudimos consultar las condiciones de cancelación. Intentá nuevamente.')
        );
      } finally {
        if (!signal?.aborted) setCargando(false);
      }
    },
    [token]
  );

  useEffect(() => {
    const controlador = new AbortController();
    void cargar(controlador.signal);
    return () => controlador.abort();
  }, [cargar]);

  const confirmar = async () => {
    setConfirmando(true);
    setErrorConfirmacion(null);
    try {
      setResultado(await confirmarArrepentimiento(token));
    } catch (e) {
      setErrorConfirmacion(aError(e, 'No pudimos cancelar la reserva. Intentá nuevamente.'));
    } finally {
      setConfirmando(false);
    }
  };

  const errorDeEnlace = errorCarga?.enlace || errorConfirmacion?.enlace;
  const sePuedeConfirmar =
    condiciones?.puede_cancelar === true && !errorConfirmacion && !resultado;

  return (
    <div className="container mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold text-tierra-900">Cancelar reserva</h1>
      <Card>
        <CardHeader>
          {/* CardTitle es un div: el h2 hace que el título se anuncie como encabezado */}
          <CardTitle>
            <h2>{resultado ? 'Reserva cancelada' : 'Botón de arrepentimiento'}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {cargando && (
            <p role="status" className="text-sm text-tierra-600">
              Cargando condiciones…
            </p>
          )}

          {errorCarga && (
            <p role="alert" className="text-sm text-destructive">
              {errorCarga.mensaje}
            </p>
          )}

          {/* Fuera de plazo, ya cancelada, en revisión...: el backend explica el motivo */}
          {condiciones && !condiciones.puede_cancelar && !resultado && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {condiciones.mensaje}
            </p>
          )}

          {sePuedeConfirmar && <DetalleCondiciones condiciones={condiciones} />}

          {errorConfirmacion && (
            <p role="alert" className="text-sm text-destructive">
              {errorConfirmacion.mensaje}
            </p>
          )}

          {resultado && (
            <div role="status" className="space-y-2">
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
                {resultado.mensaje}
              </p>
              <p className="text-sm text-tierra-900">
                Código de gestión:{' '}
                <strong className="break-all">{resultado.codigo_gestion}</strong>
              </p>
              <p className="text-sm text-tierra-600">
                Guardalo por si tenés que hacer un reclamo. También te lo enviamos por correo.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {errorDeEnlace && (
              <Button asChild variant="outline">
                <Link to="/arrepentimiento">Pedir un enlace nuevo</Link>
              </Button>
            )}
            {errorCarga && !errorCarga.enlace && (
              <Button variant="outline" onClick={() => void cargar()}>
                Reintentar
              </Button>
            )}
            {resultado ? (
              <Button asChild>
                <Link to="/">Volver al inicio</Link>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link to="/">Volver</Link>
              </Button>
            )}
            {sePuedeConfirmar && (
              <Button
                variant="destructive"
                onClick={() => void confirmar()}
                disabled={confirmando}
              >
                {confirmando ? 'Cancelando…' : 'Confirmar cancelación'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
