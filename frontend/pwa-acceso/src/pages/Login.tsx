import { AccesoDenegado } from "@/components/auth/AccesoDenegado";
import { FormularioLogin } from "@/components/auth/FormularioLogin";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { RUTA_POR_ROL } from "@/lib/auth";
import { Tent } from "lucide-react";
import { Navigate } from "react-router-dom";

/** Inicio de sesión de la web de reservas: solo para socios. */
export default function Login() {
  const { rol } = useAuth();

  // Con la sesión de socio abierta no hace falta el formulario
  if (rol === "CLIENTE") return <Navigate to={RUTA_POR_ROL.CLIENTE} replace />;
  // Un guardia o un administrador con sesión no tiene nada que hacer acá
  if (rol) return <AccesoDenegado />;

  return (
    <div className="container mx-auto px-4 py-16 max-w-md flex flex-col items-center justify-center min-h-[80vh]">
      <div className="flex items-center gap-2 mb-8 text-green-700">
        <Tent className="w-10 h-10" />
        <span className="text-3xl font-black tracking-tighter">Qamp</span>
      </div>

      <Card className="w-full shadow-lg border-zinc-200">
        <CardHeader className="text-center">
          <h1 className="text-2xl font-semibold leading-none tracking-tight">Iniciar Sesión</h1>
          <CardDescription>Ingresá con tu DNI o Correo Electrónico</CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioLogin roles={["CLIENTE"]} claseBoton="bg-green-600 hover:bg-green-700" />
        </CardContent>
      </Card>
    </div>
  );
}
