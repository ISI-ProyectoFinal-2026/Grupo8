import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CalendarDays, Info } from 'lucide-react';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { formatearFecha } from '@/lib/fechas';
import {
  describirPrecio,
  esPorUnidad,
  formatearPrecio,
  type TipoReserva,
} from '@/lib/tiposReserva';

interface EstadoBusqueda {
  fecha?: string;
  fechaEgreso?: string;
  personas?: string;
  tipo?: TipoReserva;
}

// Noches entre dos fechas AAAA-MM-DD (0 = se pasa el día)
function contarNoches(ingreso: string, egreso: string): number {
  const dia = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(egreso) - Date.parse(ingreso)) / dia);
}

// Resumen de lo elegido en el inicio, con el precio del tipo que vino del backend.
// El cupo de los días se ve en el inicio (lib/disponibilidad); el cupo y las unidades se confirman al crear la reserva.
export default function Disponibilidad() {
  const location = useLocation();
  const navigate = useNavigate();
  const { fecha, fechaEgreso, personas, tipo } = (location.state ||
    {}) as EstadoBusqueda;

  // Si entran directo a la ruta sin buscar (o con datos viejos), vuelven al inicio
  const datosCompletos = Boolean(fecha && tipo?.id);
  useEffect(() => {
    if (!datosCompletos) navigate('/');
  }, [datosCompletos, navigate]);

  if (!fecha || !tipo?.id) return null;

  const egreso = fechaEgreso || fecha;
  const noches = contarNoches(fecha, egreso);
  const porUnidad = esPorUnidad(tipo);

  return (
    <div className="container mx-auto px-4 py-12 max-w-lg">
      <Card className="shadow-lg border-tierra-200 text-center">
        <CardHeader>
          <CalendarDays className="w-14 h-14 text-bosque-600 mx-auto mb-4" />
          <CardTitle className="text-2xl text-tierra-900">
            <h1>{tipo.nombre}</h1>
          </CardTitle>
          <CardDescription>
            {egreso !== fecha
              ? `Del ${formatearFecha(fecha)} al ${formatearFecha(egreso)} · ${noches} ${noches === 1 ? 'noche' : 'noches'}`
              : `Para el día ${formatearFecha(fecha)}`}
            {personas
              ? ` · ${personas} ${personas === '1' ? 'persona' : 'personas'}`
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-tierra-50 p-4 rounded-lg">
            <p className="text-sm text-tierra-500 mb-1">Precio</p>
            <p className="text-3xl font-bold text-tierra-900">
              {describirPrecio(tipo)}
            </p>
            {porUnidad ? (
              <p className="mt-2 text-sm text-tierra-600">
                Total estimado: {formatearPrecio(tipo.precio)} × {noches}{' '}
                {noches === 1 ? 'noche' : 'noches'} ={' '}
                <strong>{formatearPrecio(tipo.precio * noches)}</strong>
              </p>
            ) : (
              <p className="mt-2 text-sm text-tierra-600">
                Los descuentos para socios y por edad se aplican al completar la
                reserva.
              </p>
            )}
          </div>
          <p className="flex items-start gap-2 text-left text-sm text-tierra-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            La disponibilidad se confirma al reservar.
          </p>
          <div className="space-y-2">
            <Button
              className="w-full bg-bosque-600 hover:bg-bosque-700 h-12 text-md"
              onClick={() =>
                navigate('/reservas', {
                  state: { fecha, fechaEgreso: egreso, personas, tipo },
                })
              }
            >
              Continuar con la reserva
            </Button>
            <Button
              variant="outline"
              className="w-full h-12 text-md"
              onClick={() => navigate('/')}
            >
              Cambiar la búsqueda
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
