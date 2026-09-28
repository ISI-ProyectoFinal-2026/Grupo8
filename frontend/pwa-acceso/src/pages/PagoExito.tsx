import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, QrCode } from "lucide-react";
import { Link } from "react-router-dom";

export default function PagoExito() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-md flex flex-col items-center justify-center min-h-[80vh]">
      <Card className="w-full shadow-lg border-green-200 text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="w-16 h-16 text-green-500" />
          </div>
          <CardTitle className="text-2xl text-green-700">¡Reserva Realizada!</CardTitle>
          <CardDescription className="text-lg">Tu pago fue acreditado con éxito.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-zinc-600">
            Ya estamos preparando tu código QR. También lo recibirás por correo electrónico.
          </p>
          {/* Este botón tendrá funcionalidad real en la Issue 11/12 */}
          <Button className="w-full bg-green-600 hover:bg-green-700 h-12 text-md flex gap-2">
            <QrCode className="w-5 h-5" />
            Descargar QR
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