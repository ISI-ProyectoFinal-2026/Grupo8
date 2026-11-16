import { Card, CardContent } from "@/components/ui/card";
import { Clock, Image as ImageIcon, Info, MapPin, ShieldCheck, Smartphone } from "lucide-react";

export default function Acerca() {
  // Simulación de los datos del camping que el usuario seleccionó previamente
  const campingSeleccionado = {
    nombre: "Camping El Nihuil",
    ubicacion: "Ruta Provincial 173, San Rafael, Mendoza",
    horarios: "Lunes a Domingos, 08:00 hs a 20:00 hs",
    temporada: "Abierto todo el año",
    descripcion: "Contamos con hectáreas parquizadas, zonas de acampe delimitadas y cabañas totalmente equipadas para que tanto familias como aventureros encuentren su espacio ideal."
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      
      {/* SECCIÓN 1: SOBRE EL SISTEMA QAMP */}
      <div className="mb-16 text-center">
        <h1 className="text-4xl font-extrabold text-tierra-900 mb-6">Sobre el Sistema Qamp</h1>
        <p className="text-lg text-tierra-600 max-w-3xl mx-auto leading-relaxed mb-8">
          Qamp es una plataforma integral de control de accesos diseñada para modernizar la gestión de campings. Nuestra aplicación web progresiva garantiza un ingreso seguro, validando tu identidad de manera instantánea mediante verificación criptográfica por código QR.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 bg-tierra-50 p-4 rounded-lg border border-tierra-100">
            <Smartphone className="w-8 h-8 text-bosque-600 shrink-0" />
            <p className="text-sm text-tierra-700 text-left">Plataforma híbrida offline-first, diseñada para funcionar incluso en zonas de baja conectividad.</p>
          </div>
          <div className="flex items-center gap-3 bg-tierra-50 p-4 rounded-lg border border-tierra-100">
            <ShieldCheck className="w-8 h-8 text-bosque-600 shrink-0" />
            <p className="text-sm text-tierra-700 text-left">Sincronización en segundo plano para proteger tus datos de reserva en todo momento.</p>
          </div>
        </div>
      </div>

      <hr className="border-tierra-200 mb-16" />

      {/* SECCIÓN 2: SOBRE EL CAMPING SELECCIONADO (Cumple DoD 8) */}
      <h2 className="text-3xl font-bold text-tierra-900 mb-8 text-center">Acerca de {campingSeleccionado.nombre}</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <Card className="text-center bg-tierra-50 border-none shadow-sm">
          <CardContent className="pt-6 flex flex-col items-center">
            <MapPin className="w-10 h-10 text-bosque-600 mb-3" />
            <h3 className="font-bold text-tierra-900 mb-1">Ubicación</h3>
            <p className="text-sm text-tierra-600">{campingSeleccionado.ubicacion}</p>
          </CardContent>
        </Card>
        
        <Card className="text-center bg-tierra-50 border-none shadow-sm">
          <CardContent className="pt-6 flex flex-col items-center">
            <Clock className="w-10 h-10 text-bosque-600 mb-3" />
            <h3 className="font-bold text-tierra-900 mb-1">Horarios</h3>
            <p className="text-sm text-tierra-600">{campingSeleccionado.horarios}</p>
          </CardContent>
        </Card>

        <Card className="text-center bg-tierra-50 border-none shadow-sm">
          <CardContent className="pt-6 flex flex-col items-center">
            <Info className="w-10 h-10 text-bosque-600 mb-3" />
            <h3 className="font-bold text-tierra-900 mb-1">Temporada</h3>
            <p className="text-sm text-tierra-600">{campingSeleccionado.temporada}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6 text-tierra-700 leading-relaxed mb-12 text-center max-w-3xl mx-auto">
        <p>{campingSeleccionado.descripcion}</p>
      </div>

      {/* Galería de fotos (marcadores de posición) */}
      <h2 className="text-2xl font-bold text-tierra-900 mb-6">Instalaciones del Predio</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((img) => (
          <div key={img} className="bg-tierra-100 rounded-xl h-48 flex flex-col items-center justify-center text-tierra-500 border-2 border-dashed border-tierra-200">
            <ImageIcon className="w-8 h-8 mb-2 opacity-50" />
            <span className="text-sm font-medium">Foto del predio {img}</span>
          </div>
        ))}
      </div>
    </div>
  );
}