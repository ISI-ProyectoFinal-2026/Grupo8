import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, type Rol } from "@/context/AuthContext";
import {
    CalendarDays,
    LayoutDashboard,
    LogOut,
    QrCode,
    Tent,
    User,
    type LucideIcon,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

interface OpcionMenu {
  ruta: string;
  texto: string;
  icono: LucideIcon;
}

// Opciones del menú "Mi Cuenta" según el rol; "Cerrar sesión" se agrega aparte para todos
const OPCIONES_POR_ROL: Record<Rol, OpcionMenu[]> = {
  CLIENTE: [
    { ruta: "/perfil", texto: "Mi Perfil", icono: User },
    { ruta: "/mis-reservas", texto: "Mis Reservas", icono: CalendarDays },
  ],
  SEGURIDAD: [{ ruta: "/acceso", texto: "Control de acceso", icono: QrCode }],
  ADMIN: [{ ruta: "/admin", texto: "Panel de administración", icono: LayoutDashboard }],
};

export function Header() {
  const { rol, cerrarSesion } = useAuth();
  const navigate = useNavigate();

  const handleCerrarSesion = () => {
    cerrarSesion();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">

        {/* Logo y Nombre */}
        <Link to="/" className="flex items-center gap-2">
          <Tent className="h-6 w-6 text-green-600" />
          <span className="text-xl font-bold text-zinc-900">Qamp</span>
        </Link>

        {/* Navegación y Botones */}
        <nav className="flex items-center gap-6">
          {/* Enlaces públicos (siempre visibles) */}
          <Link to="/beneficios" className="text-sm font-medium hover:text-green-600 transition-colors">Beneficios</Link>
          <Link to="/acerca" className="text-sm font-medium hover:text-green-600 transition-colors">Acerca de nosotros</Link>
          <Link to="/contacto" className="text-sm font-medium hover:text-green-600 transition-colors">Contacto</Link>

          {/* Botonera dinámica: visitante o menú de la cuenta según el rol */}
          {rol === null ? (
            <Button asChild className="bg-green-600 hover:bg-green-700">
              <Link to="/login">Iniciar Sesión</Link>
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <User className="h-4 w-4" />
                  Mi Cuenta
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {OPCIONES_POR_ROL[rol].map(({ ruta, texto, icono: Icono }) => (
                  <DropdownMenuItem key={ruta} asChild className="cursor-pointer">
                    <Link to={ruta} className="flex items-center gap-2">
                      <Icono className="h-4 w-4" />
                      {texto}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem className="cursor-pointer text-red-600 focus:text-red-600" onClick={handleCerrarSesion}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </nav>
      </div>
    </header>
  );
}