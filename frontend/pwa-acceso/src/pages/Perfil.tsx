import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarDays, Save, User } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Perfil() {
  const navigate = useNavigate();
  // Estado simulado del usuario
  const [datos, setDatos] = useState({
    nombre: "Emiliana Bianchi",
    dni: "41234567",
    email: "emiliana@ejemplo.com",
    estadoSocio: "Activo",
  });

  const handleGuardar = (e: React.FormEvent) => {
    e.preventDefault();
    alert("Datos actualizados correctamente (Simulación)");
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Mi Perfil</h1>
          <p className="text-zinc-600 mt-1">Gestioná tu información personal</p>
        </div>
        <Button 
          onClick={() => navigate("/mis-reservas")}
          className="bg-zinc-900 hover:bg-zinc-800 flex gap-2"
        >
          <CalendarDays className="w-4 h-4" />
          Ver mis reservas
        </Button>
      </div>

      <Card>
        <CardHeader className="bg-zinc-50 border-b pb-6 flex flex-row items-center gap-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-700">
            <User className="w-8 h-8" />
          </div>
          <div>
            <CardTitle className="text-xl">{datos.nombre}</CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              Estado: 
              <Badge variant={datos.estadoSocio === "Activo" ? "default" : "destructive"} className="bg-green-600">
                Socio {datos.estadoSocio}
              </Badge>
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleGuardar} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre completo</Label>
                <Input value={datos.nombre} onChange={(e) => setDatos({...datos, nombre: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>DNI</Label>
                <Input value={datos.dni} onChange={(e) => setDatos({...datos, dni: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Correo electrónico</Label>
                <Input type="email" value={datos.email} onChange={(e) => setDatos({...datos, email: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Nueva contraseña</Label>
                <Input type="password" placeholder="••••••••" />
              </div>
            </div>
            <Button type="submit" className="mt-6 flex gap-2">
              <Save className="w-4 h-4" />
              Guardar cambios
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}