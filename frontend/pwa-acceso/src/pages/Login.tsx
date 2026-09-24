import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tent } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();
  const [identificacion, setIdentificacion] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulación de login exitoso
    navigate("/perfil");
  };

  return (
    <div className="container mx-auto px-4 py-16 max-w-md flex flex-col items-center justify-center min-h-[80vh]">
      <div className="flex items-center gap-2 mb-8 text-green-700">
        <Tent className="w-10 h-10" />
        <span className="text-3xl font-black tracking-tighter">Qamp</span>
      </div>
      
      <Card className="w-full shadow-lg border-zinc-200">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Iniciar Sesión</CardTitle>
          <CardDescription>Ingresá con tu DNI o Correo Electrónico</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identificacion">DNI o Email</Label>
              <Input 
                id="identificacion" 
                required 
                placeholder="ej: emiliana@correo.com o 12345678"
                value={identificacion}
                onChange={(e) => setIdentificacion(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="password">Contraseña</Label>
                <Link to="#" className="text-xs text-green-600 hover:underline">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <Input 
                id="password" 
                type="password" 
                required 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full bg-green-600 hover:bg-green-700 h-11 text-md mt-4">
              Ingresar
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center border-t p-4 mt-2">
          <p className="text-sm text-zinc-600">
            ¿No sos socio todavía?{" "}
            <Link to="#" className="text-green-600 font-semibold hover:underline">
              Registrarme
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}