import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CalendarDays, LogOut, Tent, User } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

export function Header() {
  // TODO: Más adelante, esto vendrá del estado global o contexto de autenticación
  const [isAuthenticated, setIsAuthenticated] = useState(false);

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

          {/* Botonera dinámica según si inició sesión o no */}
          {!isAuthenticated ? (
            // Vista de Visitante
            <Button asChild className="bg-green-600 hover:bg-green-700">
              <Link to="/login">Iniciar Sesión</Link>
            </Button>
          ) : (
            // Vista de Socio / Usuario Logueado
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <User className="h-4 w-4" />
                  Mi Cuenta
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link to="/perfil" className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Mi Perfil
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link to="/mis-reservas" className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    Mis Reservas
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-red-600 focus:text-red-600" onClick={() => setIsAuthenticated(false)}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          
          {/* Botón temporal solo para que puedas probar cómo cambia la vista mientras programás */}
          <button 
            onClick={() => setIsAuthenticated(!isAuthenticated)} 
            className="text-[10px] text-gray-300 absolute top-0 right-0 p-1"
            title="Cambiar estado (solo para pruebas)"
          >
            SW
          </button>
        </nav>
      </div>
    </header>
  );
}