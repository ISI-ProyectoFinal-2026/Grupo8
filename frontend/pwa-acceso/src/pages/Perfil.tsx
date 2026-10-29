import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUsuarioSocio } from "@/components/auth/RutaSocio";
import { formatearFecha } from "@/lib/fechas";
import { CalendarDays, User } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Perfil() {
  const navigate = useNavigate();
  // Los datos vienen de GET /auth/me, que consulta RutaSocio antes de mostrar esta pantalla
  const usuario = useUsuarioSocio();

  const vence = usuario.membresia_vence ? formatearFecha(usuario.membresia_vence) : null;
  const detalleMembresia = !vence
    ? "Sin fecha de vencimiento registrada"
    : usuario.membresia_vigente
      ? `Vigente hasta el ${vence}`
      : `Venció el ${vence}`;

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Mi Perfil</h1>
          <p className="text-zinc-600 mt-1">Tu información personal y el estado de tu membresía</p>
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
            <CardTitle className="text-xl">{usuario.nombre}</CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
              <Badge
                variant={usuario.membresia_vigente ? "default" : "destructive"}
                className={usuario.membresia_vigente ? "bg-green-600" : ""}
              >
                {usuario.membresia_vigente ? "Membresía vigente" : "Membresía vencida"}
              </Badge>
              <span>{detalleMembresia}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="perfil-nombre">Nombre completo</Label>
              <Input id="perfil-nombre" value={usuario.nombre} readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="perfil-dni">DNI</Label>
              <Input id="perfil-dni" value={usuario.dni} readOnly />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="perfil-email">Correo electrónico</Label>
              <Input id="perfil-email" type="email" value={usuario.email} readOnly />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}