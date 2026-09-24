import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, QrCode, Tent, Users, Zap } from "lucide-react";

export default function Beneficios() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      
      {/* BENEFICIOS DEL SISTEMA QAMP */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-extrabold text-zinc-900 tracking-tight mb-4">La Experiencia Qamp</h1>
        <p className="text-lg text-zinc-600 max-w-2xl mx-auto">
          Al gestionar tu estadía a través de nuestra plataforma, disfrutás de ventajas tecnológicas pensadas para optimizar tu tiempo.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        <Card className="bg-zinc-900 text-white border-none shadow-lg">
          <CardHeader className="pb-2">
            <QrCode className="w-10 h-10 text-green-400 mb-2" />
            <CardTitle className="text-xl">Ingreso Express</CardTitle>
          </CardHeader>
          <CardContent className="text-zinc-300">
            Olvidate de las filas en la recepción. Presentá tu código QR en la entrada y el personal validará tu acceso y el de tus acompañantes en cuestión de segundos.
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 text-white border-none shadow-lg">
          <CardHeader className="pb-2">
            <Zap className="w-10 h-10 text-green-400 mb-2" />
            <CardTitle className="text-xl">Autogestión Inteligente</CardTitle>
          </CardHeader>
          <CardContent className="text-zinc-300">
            Consultá la disponibilidad en tiempo real, calculá tus tarifas dinámicas al instante y descargá tus comprobantes para llevarlos en tu celular.
          </CardContent>
        </Card>
      </div>

      <hr className="border-zinc-200 mb-12" />

      {/* BENEFICIOS DEL CAMPING (Cumple DoD 7) */}
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold text-zinc-900 mb-2">Beneficios en el Predio</h2>
        <p className="text-zinc-600">Conocé las comodidades que ofrece el camping según tu tipo de ingreso.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Tarjeta Visitantes */}
        <Card className="border-zinc-200 shadow-md">
          <CardHeader className="bg-zinc-50 border-b pb-6">
            <Tent className="w-12 h-12 text-zinc-700 mb-4" />
            <CardTitle className="text-2xl">Visitantes Generales</CardTitle>
            <CardDescription>Para quienes buscan pasar el día.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <ul className="space-y-3">
              {["Acceso a parrillas y quinchos compartidos.", "Uso de sanitarios y duchas con agua caliente.", "Acceso a la proveeduría del camping.", "Estacionamiento gratuito por el día.", "Seguridad y asistencia 24hs."].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  <span className="text-zinc-700">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Tarjeta Socios */}
        <Card className="border-green-200 shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-green-600 text-white px-4 py-1 text-sm font-bold rounded-bl-lg">
            Recomendado
          </div>
          <CardHeader className="bg-green-50 border-b border-green-100 pb-6">
            <Users className="w-12 h-12 text-green-700 mb-4" />
            <CardTitle className="text-2xl text-green-900">Socios del Predio</CardTitle>
            <CardDescription className="text-green-800">La experiencia completa con ventajas exclusivas.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <ul className="space-y-3">
              {["Descuento del 50% en tarifas de ingreso y acampe.", "Reserva prioritaria de cabañas en temporada alta.", "Check-in aún más rápido vinculando el DNI.", "Descuentos en actividades guiadas y proveeduría."].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  <span className="font-medium text-zinc-900">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      
    </div>
  );
}