import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { ErrorLogin, RUTA_POR_ROL, solicitarLogin } from "@/lib/auth";
import { Tent } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";

export default function Login() {
  const { rol, iniciarSesion } = useAuth();
  const [identificacion, setIdentificacion] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Con la sesión abierta no hace falta el formulario: va directo a la pantalla de su rol
  if (rol) return <Navigate to={RUTA_POR_ROL[rol]} replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setEnviando(true);
    try {
      const token = await solicitarLogin(identificacion, password);
      // Al abrir la sesión esta pantalla redirige sola según el rol
      if (!iniciarSesion(token)) setError("No se pudo iniciar la sesión. Intentá de nuevo.");
    } catch (err) {
      setError(
        err instanceof ErrorLogin ? err.message : "Ocurrió un error inesperado. Intentá de nuevo."
      );
    } finally {
      setEnviando(false);
    }
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
                autoComplete="username"
                placeholder="ej: emiliana@correo.com o 12345678"
                value={identificacion}
                onChange={(e) => setIdentificacion(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={enviando}
              className="w-full bg-green-600 hover:bg-green-700 h-11 text-md mt-4"
            >
              {enviando ? "Ingresando..." : "Ingresar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}