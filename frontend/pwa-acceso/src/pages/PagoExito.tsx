import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  QrCode,
  XCircle,
} from 'lucide-react';
import {
  ErrorEstadoPago,
  consultarEstadoPago,
  type EstadoPagoRetorno,
} from '@/lib/estadoPago';
import { formatearFecha } from '@/lib/fechas';
import { guardarArchivo } from '@/lib/misReservas';
import {
  ErrorQrPago,
  MENSAJE_DATOS_FALTANTES,
  MENSAJE_ERROR_DESCARGA,
  datosDelRetorno,
  descargarQrDelPago,
  type DatosRetorno,
} from '@/lib/qrPago';
import {
  borrarReservaPendiente,
  leerReservaPendiente,
} from '@/lib/reservaPendiente';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

// Mientras el pago está en proceso se vuelve a consultar cada 3 segundos, durante un minuto
export const INTERVALO_REINTENTO_MS = 3000;
export const MAX_INTENTOS = 20;

type Vista =
  | { tipo: 'consultando' }
  | { tipo: 'resultado'; resultado: EstadoPagoRetorno }
  | { tipo: 'datos_invalidos'; mensaje: string }
  | { tipo: 'agotado' };

interface Aviso {
  // generando: se puede reintentar; error: no se pudo y el QR llega por correo
  tipo: 'generando' | 'error';
  texto: string;
}

export default function PagoExito() {
  const [params] = useSearchParams();
  // Reserva y pago con los que vuelve Mercado Pago
  const datos = useMemo(() => datosDelRetorno(params), [params]);
  const [vista, setVista] = useState<Vista>(() =>
    datos
      ? { tipo: 'consultando' }
      : { tipo: 'datos_invalidos', mensaje: MENSAJE_DATOS_FALTANTES }
  );
  // Cada cambio de intento dispara una consulta nueva
  const [intento, setIntento] = useState(0);
  const [ronda, setRonda] = useState(0);

  useEffect(() => {
    if (!datos) return;
    let cancelado = false;
    let espera: ReturnType<typeof setTimeout> | undefined;

    const reintentar = () => {
      if (intento + 1 >= MAX_INTENTOS) {
        setVista({ tipo: 'agotado' });
        return;
      }
      espera = setTimeout(
        () => setIntento((i) => i + 1),
        INTERVALO_REINTENTO_MS
      );
    };

    consultarEstadoPago(datos)
      .then((resultado) => {
        if (cancelado) return;
        setVista({ tipo: 'resultado', resultado });
        if (resultado.estado === 'en_proceso') reintentar();
      })
      .catch((e: unknown) => {
        if (cancelado) return;
        if (e instanceof ErrorEstadoPago && e.motivo === 'datos') {
          setVista({ tipo: 'datos_invalidos', mensaje: e.message });
        } else {
          // Falla pasajera (Mercado Pago o la conexión): se sigue intentando
          reintentar();
        }
      });

    return () => {
      cancelado = true;
      if (espera) clearTimeout(espera);
    };
  }, [datos, intento, ronda]);

  // Con la reserva ya resuelta no se ofrece pagarla otra vez. Si el pago se rechazó, se
  // conserva para poder reintentar desde la pantalla de pago
  const estado = vista.tipo === 'resultado' ? vista.resultado.estado : null;
  useEffect(() => {
    if (estado === 'confirmada' || estado === 'cancelada') {
      borrarReservaPendiente();
    }
  }, [estado]);

  const consultarDeNuevo = () => {
    setVista({ tipo: 'consultando' });
    setIntento(0);
    setRonda((r) => r + 1);
  };

  if (vista.tipo === 'consultando') {
    return <EnProceso />;
  }
  if (vista.tipo === 'agotado') {
    return (
      <Pantalla
        icono={<Clock className="w-16 h-16 text-amber-600" />}
        titulo="Tu pago todavía se está procesando"
        descripcion="Cuando se confirme, te enviamos el QR por correo electrónico."
      >
        <Button
          className="w-full bg-bosque-600 hover:bg-bosque-700 h-12 text-md"
          onClick={consultarDeNuevo}
        >
          Consultar de nuevo
        </Button>
        <VolverAlInicio />
      </Pantalla>
    );
  }
  if (vista.tipo === 'datos_invalidos') {
    return <NoConfirmado mensaje={vista.mensaje} />;
  }

  const { resultado } = vista;
  switch (resultado.estado) {
    case 'confirmada':
      // Con la reserva confirmada los datos de la URL ya se comprobaron
      return datos ? <Confirmada resultado={resultado} datos={datos} /> : null;
    case 'en_proceso':
      return <EnProceso codigo={resultado.reserva.codigo} />;
    case 'rechazado':
      return <NoConfirmado mensaje={resultado.mensaje} />;
    case 'cancelada':
      return (
        <Pantalla
          icono={<XCircle className="w-16 h-16 text-red-500" />}
          titulo="Reserva cancelada"
          descripcion={resultado.mensaje}
        >
          <VolverAlInicio />
        </Pantalla>
      );
    case 'revision':
      return (
        <Pantalla
          icono={<AlertTriangle className="w-16 h-16 text-amber-600" />}
          titulo="Estamos revisando tu pago"
          descripcion={resultado.mensaje}
        >
          <VolverAlInicio />
        </Pantalla>
      );
  }
}

function Pantalla({
  icono,
  titulo,
  descripcion,
  children,
}: {
  icono: ReactNode;
  titulo: string;
  descripcion: string;
  children: ReactNode;
}) {
  return (
    <div className="container mx-auto px-4 py-16 max-w-md flex flex-col items-center justify-center min-h-[80vh]">
      <Card className="w-full shadow-lg border-bosque-200 text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">{icono}</div>
          <CardTitle className="text-2xl text-bosque-700">
            <h1>{titulo}</h1>
          </CardTitle>
          <CardDescription className="text-lg">{descripcion}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">{children}</CardContent>
      </Card>
    </div>
  );
}

function VolverAlInicio() {
  return (
    <div className="pt-4">
      <Button asChild variant="outline" className="w-full">
        <Link to="/">Volver al inicio</Link>
      </Button>
    </div>
  );
}

function EnProceso({ codigo }: { codigo?: string }) {
  return (
    <Pantalla
      icono={
        <Loader2 className="w-16 h-16 text-bosque-500 motion-safe:animate-spin" />
      }
      titulo="Estamos confirmando tu pago"
      descripcion="Puede tardar unos segundos. No hace falta que recargues la página."
    >
      <p role="status" className="text-tierra-600">
        {codigo
          ? `Reserva ${codigo}: esperando la confirmación de Mercado Pago…`
          : 'Consultando el estado del pago…'}
      </p>
    </Pantalla>
  );
}

function NoConfirmado({ mensaje }: { mensaje: string }) {
  // Si la reserva sigue guardada, se vuelve a la pantalla de pago; si no, a reservar de nuevo
  const destino = leerReservaPendiente() ? '/reservas/pagar' : '/reservas';
  return (
    <Pantalla
      icono={<XCircle className="w-16 h-16 text-red-500" />}
      titulo="No pudimos confirmar tu pago"
      descripcion="Tu reserva no está confirmada."
    >
      <p role="alert" className="text-destructive">
        {mensaje}
      </p>
      <Button
        asChild
        className="w-full bg-bosque-600 hover:bg-bosque-700 h-12 text-md"
      >
        <Link to={destino}>Volver a intentar</Link>
      </Button>
      <VolverAlInicio />
    </Pantalla>
  );
}

function Confirmada({
  resultado,
  datos,
}: {
  resultado: EstadoPagoRetorno;
  datos: DatosRetorno;
}) {
  const { reserva } = resultado;
  const [descargando, setDescargando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const descargar = async () => {
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

  const fechas =
    reserva.fecha_ingreso === reserva.fecha_egreso
      ? formatearFecha(reserva.fecha_ingreso)
      : `${formatearFecha(reserva.fecha_ingreso)} al ${formatearFecha(reserva.fecha_egreso)}`;

  return (
    <Pantalla
      icono={<CheckCircle2 className="w-16 h-16 text-bosque-500" />}
      titulo="¡Reserva Realizada!"
      descripcion="Tu pago fue acreditado con éxito."
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-left text-tierra-700">
        <dt className="font-medium">Código de reserva</dt>
        <dd>{reserva.codigo}</dd>
        <dt className="font-medium">Fecha</dt>
        <dd>{fechas}</dd>
        <dt className="font-medium">Personas</dt>
        <dd>{reserva.cantidad_personas}</dd>
        <dt className="font-medium">Reserva</dt>
        <dd>Confirmada</dd>
        <dt className="font-medium">Pago</dt>
        <dd>Acreditado</dd>
      </dl>
      <p className="text-tierra-600">
        Tu código QR también te llega por correo electrónico.
      </p>

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
        disabled={descargando}
      >
        <QrCode className="w-5 h-5" />
        {descargando ? 'Descargando…' : 'Descargar QR'}
      </Button>
      <VolverAlInicio />
    </Pantalla>
  );
}
