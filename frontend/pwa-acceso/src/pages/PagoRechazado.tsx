import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { XCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

export default function PagoRechazado() {
  const navigate = useNavigate();

  return (
    <div className="container mx-auto px-4 py-16 max-w-md flex flex-col items-center justify-center min-h-[80vh]">
      <Card className="w-full shadow-lg border-red-200 text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <XCircle className="w-16 h-16 text-red-500" />
          </div>
          <CardTitle className="text-2xl text-red-700">Pago Rechazado</CardTitle>
          <CardDescription className="text-lg">No pudimos procesar el pago.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-zinc-600">
            Hubo un problema con la transacción o la pasarela de pagos. Tu reserva no ha sido confirmada.
          </p>
          <Button 
            onClick={() => navigate(-1)} 
            className="w-full bg-red-600 hover:bg-red-700 h-12 text-md"
          >
            Intentar nuevamente
          </Button>
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