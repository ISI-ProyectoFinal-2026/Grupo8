import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, type Rol } from "@/context/AuthContext";
import { CAMPING } from "@/lib/camping";
import { cn } from "@/lib/utils";
import {
    CalendarDays,
    LayoutDashboard,
    LogOut,
    QrCode,
    Tent,
    User,
    type LucideIcon,
} from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";

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

const ENLACES = [
  { ruta: "/beneficios", texto: "Beneficios" },
  { ruta: "/acerca", texto: "Acerca de nosotros" },
  { ruta: "/contacto", texto: "Contacto" },
];

// Pestañas como en el estilo de referencia: texto simple y la actual marcada con una píldora
const clasePestania = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-full px-4 py-2 text-sm font-medium transition-colors",
    isActive ? "bg-white text-foreground shadow-sm" : "text-tierra-700 hover:bg-white/60 hover:text-foreground"
  );

export function Header() {
  const { rol, cerrarSesion } = useAuth();
  const navigate = useNavigate();

  const handleCerrarSesion = () => {
    cerrarSesion();
    navigate("/");
  };

  return (
    // Sin color propio: se ve el mismo fondo que el resto de la página
    <header className="relative w-full">
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-3">

        {/* Nombre del camping (se configura en el .env) */}
        <Link to="/" className="flex items-center gap-2 rounded-full text-foreground">
          <Tent className="h-6 w-6 text-primary" aria-hidden="true" />
          <span className="text-xl font-semibold">{CAMPING.nombre}</span>
        </Link>

        {/* Navegación y Botones */}
        <nav aria-label="Navegación principal" className="flex flex-wrap items-center gap-1">
          {ENLACES.map(({ ruta, texto }) => (
            <NavLink key={ruta} to={ruta} className={clasePestania}>
              {texto}
            </NavLink>
          ))}

          {/* Botonera dinámica: visitante o menú de la cuenta según el rol */}
          <div className="ml-2">
            {rol === null ? (
              <Button asChild>
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
                <DropdownMenuContent align="end" className="w-56 rounded-2xl">
                  {OPCIONES_POR_ROL[rol].map(({ ruta, texto, icono: Icono }) => (
                    <DropdownMenuItem key={ruta} asChild className="cursor-pointer rounded-xl">
                      <Link to={ruta} className="flex items-center gap-2">
                        <Icono className="h-4 w-4" />
                        {texto}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    className="cursor-pointer rounded-xl text-destructive focus:text-destructive"
                    onClick={handleCerrarSesion}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Cerrar sesión
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
