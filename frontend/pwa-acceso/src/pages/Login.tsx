import { AccesoDenegado } from "@/components/auth/AccesoDenegado";
import { FormularioLogin } from "@/components/auth/FormularioLogin";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { RUTA_POR_ROL } from "@/lib/auth";
import { Navigate } from "react-router-dom";

/** Inicio de sesión de la web de reservas: solo para socios. */
export default function Login() {
  const { rol } = useAuth();

  // Con la sesión de socio abierta no hace falta el formulario
  if (rol === "CLIENTE") return <Navigate to={RUTA_POR_ROL.CLIENTE} replace />;
  // Un guardia o un administrador con sesión no tiene nada que hacer acá
  if (rol) return <AccesoDenegado />;

  return (
    <div className="container mx-auto px-4 py-16 max-w-md flex flex-col items-center justify-center min-h-[60vh]">
      {/* El nombre del camping ya está en el encabezado de la web */}
      <Card className="w-full">
        <CardHeader className="text-center">
          <h1 className="text-2xl font-semibold leading-none tracking-tight">Iniciar Sesión</h1>
          <CardDescription>Ingresá con tu DNI o Correo Electrónico</CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioLogin roles={["CLIENTE"]} claseBoton="h-12" />
        </CardContent>
      </Card>
    </div>
  );
}
