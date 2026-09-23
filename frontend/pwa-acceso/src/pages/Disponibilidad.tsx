import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export default function Disponibilidad() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Rescatamos los datos que mandó el Home
  const { fecha, personas, tipo } = location.state || {};

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
  try {
    /* 
      ATENCIÓN: Reemplazar 'http://localhost:8000/api/reservas/disponibilidad' 
      por la URL exacta y el puerto que use el backend.
    */
    const url = `http://localhost:8000/api/reservas/disponibilidad?fecha=${fecha}&tipo=${tipo}&personas=${personas}`;
    
    const respuesta = await fetch(url);
    
    if (respuesta.ok) {
      const data = await respuesta.json();
      // Asumimos que el backend responde algo como { disponible: true, precio: 15000 }
      setHayDisponibilidad(data.disponible);
      setPrecio(data.precio || 0);
    } else {
      // Si el backend responde con error (ej. 404 o 400), asumimos que no hay lugar
      setHayDisponibilidad(false);
    }
  } catch (error) {
    console.error("Error de conexión con el backend:", error);
    // Si el backend está apagado, mostramos que no hay disponibilidad por seguridad
    setHayDisponibilidad(false);
  } finally {
    setCargando(false);
  }
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
              <CardDescription>Para el día {new Date(fecha).toLocaleDateString('es-AR')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-zinc-50 p-4 rounded-lg">
                <p className="text-sm text-zinc-500 mb-1">Precio estimado por persona</p>
                <p className="text-3xl font-bold text-zinc-900">${precio.toLocaleString('es-AR')}</p>
              </div>
              <Button className="w-full bg-green-600 hover:bg-green-700 h-12 text-md">
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
              <CardDescription>Lo sentimos, no hay cupos para la fecha seleccionada ({new Date(fecha).toLocaleDateString('es-AR')}).</CardDescription>
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