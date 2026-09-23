import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, MapPin, Phone } from "lucide-react";

export default function Contacto() {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert("¡Mensaje enviado correctamente! Nos pondremos en contacto a la brevedad.");
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        
        {/* Info Directa */}
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 mb-6">Comunicate con nosotros</h1>
          <p className="text-zinc-600 mb-8">
            Si tenés alguna duda escribinos y te responderemos lo más rápido posible.
          </p>
          
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-green-700">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900">Teléfono / WhatsApp</p>
                <p className="text-zinc-600">+54 9 260 412-3456</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-green-700">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900">Correo Electrónico</p>
                <p className="text-zinc-600">somosqamp@gmail.com</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-green-700">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900">Ubicación</p>
                <p className="text-zinc-600">San Rafael, Mendoza</p>
              </div>
            </div>
          </div>
        </div>

        {/* Formulario */}
        <Card className="shadow-lg border-zinc-200">
          <CardHeader>
            <CardTitle>Envianos un mensaje</CardTitle>
            <CardDescription>Completá el formulario y te contactaremos por email.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre completo</Label>
                <Input id="nombre" required placeholder="Tu nombre" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input id="email" type="email" required placeholder="ejemplo@correo.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mensaje">Mensaje</Label>
                <Textarea 
                  id="mensaje" 
                  required 
                  placeholder="Escribí tu consulta acá..." 
                  className="min-h-[120px]"
                />
              </div>
              <Button type="submit" className="w-full bg-green-600 hover:bg-green-700 h-11 text-md mt-4">
                Enviar mensaje
              </Button>
            </form>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}