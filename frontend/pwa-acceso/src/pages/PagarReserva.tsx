import { CuentaRegresiva } from '@/components/CuentaRegresiva';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  borrarReservaPendiente,
  crearPago,
  leerReservaPendiente,
  msRestantes,
  type ReservaPendiente,
} from '@/lib/reservaPendiente';
import { Clock, TimerOff } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

/**
 * Paso entre la reserva y Mercado Pago: muestra cuánto tiempo queda para pagar.
 * Si la persona vuelve de Mercado Pago sin haber pagado (por ejemplo, después de un rechazo),
 * puede reintentar desde acá mientras dure el plazo.
 */
export default function PagarReserva() {
  const navigate = useNavigate();
  const location = useLocation();
  const [reserva] = useState<ReservaPendiente | null>(
    () => (location.state as { reserva?: ReservaPendiente } | null)?.reserva ?? leerReservaPendiente()
  );
  const [vencida, setVencida] = useState(() => (reserva ? msRestantes(reserva.vencimiento) === 0 : false));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empezarDeNuevo = () => {
    borrarReservaPendiente();
    navigate('/');
  };

  const irAPagar = async () => {
    if (!reserva || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const resultado = await crearPago(reserva);
      if (resultado.tipo === 'ok') {
        window.location.href = resultado.initPoint;
        return;
      }
      if (resultado.tipo === 'vencida') {
        setVencida(true);
        return;
      }
      setError(resultado.mensaje);
    } catch {
      setError('Ocurrió un error de red. Verificá que el servidor backend esté encendido.');
    } finally {
      setEnviando(false);
    }
  };

  if (!reserva) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-md flex flex-col items-center justify-center min-h-[80vh]">
        <Card className="w-full shadow-lg text-center">
          <CardHeader>
            <CardTitle className="text-2xl">No hay una reserva para pagar</CardTitle>
            <CardDescription className="text-lg">Empezá una reserva nueva desde el inicio.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/">
              <Button className="w-full h-12 text-md">Volver al inicio</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (vencida) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-md flex flex-col items-center justify-center min-h-[80vh]">
        <Card className="w-full shadow-lg border-red-200 text-center">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <TimerOff className="w-16 h-16 text-red-500" />
            </div>
            <CardTitle className="text-2xl text-red-700">Tu reserva venció</CardTitle>
            <CardDescription className="text-lg">Se terminó el tiempo para pagar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-zinc-600">
              Liberamos los lugares que tenías guardados. Si todavía querés ir, hacé una reserva nueva.
            </p>
            <Button onClick={empezarDeNuevo} className="w-full bg-red-600 hover:bg-red-700 h-12 text-md">
              Empezar de nuevo
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-16 max-w-md flex flex-col items-center justify-center min-h-[80vh]">
      <Card className="w-full shadow-lg border-green-200 text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <Clock className="w-16 h-16 text-green-600" />
          </div>
          <CardTitle className="text-2xl text-green-700">Tu reserva está guardada</CardTitle>
          <CardDescription className="text-lg">{reserva.titulo}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-zinc-600">Tenés este tiempo para pagar:</p>
            <CuentaRegresiva
              vencimiento={reserva.vencimiento}
              onVencido={() => setVencida(true)}
              className="block text-5xl font-bold tabular-nums text-zinc-900 mt-2"
            />
          </div>
          <p className="text-sm text-zinc-500">
            Pasado ese tiempo la reserva se cancela y los lugares quedan libres para otras personas.
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button
            onClick={irAPagar}
            disabled={enviando}
            className="w-full bg-green-600 hover:bg-green-700 h-12 text-md"
          >
            {enviando ? 'Conectando con Mercado Pago…' : 'Ir a pagar'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
