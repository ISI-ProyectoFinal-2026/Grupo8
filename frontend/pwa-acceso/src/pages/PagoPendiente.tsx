import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { Link } from "react-router-dom";

// esta página de PagoPendiente sigue el mismo estilo que PagoExito y PagoRechazado, ya que no esta definido.

export default function PagoPendiente() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-md flex flex-col items-center justify-center min-h-[80vh]">
      <Card className="w-full shadow-lg border-yellow-200 text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <Clock className="w-16 h-16 text-yellow-500" />
          </div>
          <CardTitle className="text-2xl text-yellow-700">Pago pendiente</CardTitle>
          <CardDescription className="text-lg">
            Estamos esperando la confirmación de tu pago.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-zinc-600">
            Mercado Pago todavía no informó el resultado de la operación. Tu reserva quedará en
            espera y, cuando se confirme el pago, te enviaremos el código QR por correo electrónico.
          </p>
          <Link to="/mis-reservas">
            <Button className="w-full bg-yellow-700 hover:bg-yellow-800 h-12 text-md">
              Ver mis reservas
            </Button>
          </Link>
          <div className="pt-4">
            <Link to="/">
              <Button variant="outline" className="w-full">Volver al inicio</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}