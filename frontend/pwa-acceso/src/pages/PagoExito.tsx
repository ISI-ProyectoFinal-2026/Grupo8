import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CheckCircle2, QrCode } from 'lucide-react';
import { guardarArchivo } from '@/lib/misReservas';
import {
  ErrorQrPago,
  MENSAJE_DATOS_FALTANTES,
  MENSAJE_ERROR_DESCARGA,
  datosDelRetorno,
  descargarQrDelPago,
} from '@/lib/qrPago';
import { borrarReservaPendiente } from '@/lib/reservaPendiente';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

interface Aviso {
  // generando: se puede reintentar; error: no se pudo y el QR llega por correo
  tipo: 'generando' | 'error';
  texto: string;
}

export default function PagoExito() {
  const [params] = useSearchParams();
  // Reserva y pago con los que vuelve Mercado Pago
  const datos = useMemo(() => datosDelRetorno(params), [params]);
  const [descargando, setDescargando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  // El pago ya está hecho o en proceso: no se ofrece pagar otra vez la misma reserva
  useEffect(() => {
    borrarReservaPendiente();
  }, []);

  const descargar = async () => {
    if (!datos) return;
    setDescargando(true);
    setAviso(null);
    try {
      const qr = await descargarQrDelPago(datos);
      guardarArchivo(qr, `QR_Acceso_${datos.reservaId}.png`);
    } catch (e) {
      if (e instanceof ErrorQrPago && e.motivo === 'generando') {
        setAviso({ tipo: 'generando', texto: e.message });
      } else {
        setAviso({
          tipo: 'error',
          texto: e instanceof Error ? e.message : MENSAJE_ERROR_DESCARGA,
        });
      }
    } finally {
      setDescargando(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-16 max-w-md flex flex-col items-center justify-center min-h-[80vh]">
      <Card className="w-full shadow-lg border-bosque-200 text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="w-16 h-16 text-bosque-500" />
          </div>
          <CardTitle className="text-2xl text-bosque-700">
            <h1>¡Reserva Realizada!</h1>
          </CardTitle>
          <CardDescription className="text-lg">
            Tu pago fue acreditado con éxito.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-tierra-600">
            Ya estamos preparando tu código QR. También lo recibirás por correo
            electrónico.
          </p>

          {!datos && (
            <p role="alert" className="text-destructive">
              {MENSAJE_DATOS_FALTANTES}
            </p>
          )}
          {aviso?.tipo === 'generando' && (
            <p
              role="status"
              className="rounded-md bg-amber-50 px-3 py-2 text-amber-900"
            >
              {aviso.texto}
            </p>
          )}
          {aviso?.tipo === 'error' && (
            <p role="alert" className="text-destructive">
              {aviso.texto}
            </p>
          )}

          <Button
            className="w-full bg-bosque-600 hover:bg-bosque-700 h-12 text-md flex gap-2"
            onClick={descargar}
            disabled={!datos || descargando}
          >
            <QrCode className="w-5 h-5" />
            {descargando ? 'Descargando…' : 'Descargar QR'}
          </Button>
          <div className="pt-4">
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Volver al inicio</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
