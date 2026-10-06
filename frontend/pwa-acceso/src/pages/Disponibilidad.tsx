import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { formatearFecha } from "@/lib/fechas";

export default function Disponibilidad() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Rescatamos los datos que mandó el Home
  const { fecha, fechaEgreso, personas, tipo } = location.state || {};

  const [cargando, setCargando] = useState(true);
  const [hayDisponibilidad, setHayDisponibilidad] = useState(false);
  const [precio, setPrecio] = useState(0);

  useEffect(() => {
    // Si entran directo a la ruta sin buscar, los pateamos al inicio
    if (!fecha) {
      navigate("/");
      return;
    }

  const consultarBackend = async () => {
      // TEMPORAL PARA PROBAR LA PANTALLA DE RESERVAS. COMENTAR CUANDO EL BACKEND ESTÉ LISTO Y DESCOMENTAR FUNCIÓN DE ABAJO.
      setTimeout(() => {
        setHayDisponibilidad(true); 
        setPrecio(tipo === 'cabana' ? 25000 : 5000);
        setCargando(false);
      }, 800);
    };

    consultarBackend();
  }, [fecha, tipo, personas, navigate]);

  if (cargando) {
    return <div className="text-center py-20 text-lg">Consultando sistema de reservas...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-lg">
      <Card className="shadow-lg border-zinc-200 text-center">
        {hayDisponibilidad ? (
          // PANTALLA: ÉXITO
          <>
            <CardHeader>
              <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <CardTitle className="text-2xl text-green-700">¡Hay disponibilidad!</CardTitle>
              <CardDescription>Para el día {formatearFecha(fecha)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-zinc-50 p-4 rounded-lg">
                <p className="text-sm text-zinc-500 mb-1">Precio estimado por persona</p>
                <p className="text-3xl font-bold text-zinc-900">${precio.toLocaleString('es-AR')}</p>
              </div>
              <Button 
                className="w-full bg-green-600 hover:bg-green-700 h-12 text-md"
                onClick={() => navigate("/reservas", { state: { fecha, fechaEgreso, personas, tipo, precio } })}
              >
                Proceder a Reservar
              </Button>
            </CardContent>
          </>
        ) : (
          // PANTALLA: FALLO
          <>
            <CardHeader>
              <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <CardTitle className="text-2xl text-red-700">Sin disponibilidad</CardTitle>
              <CardDescription>Lo sentimos, no hay cupos para la fecha seleccionada ({formatearFecha(fecha)}).</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                variant="outline" 
                className="w-full h-12 text-md"
                onClick={() => navigate("/")}
              >
                Elegir otra fecha
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}