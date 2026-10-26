import { BrowserRouter, Route, Routes } from "react-router-dom";
import { LayoutPublico } from "./components/layout/LayoutPublico";
import { AuthProvider } from "./context/AuthContext";
import AdminRoutes from "./pages/admin/AdminRoutes";
import Acerca from "./pages/Acerca";
import Beneficios from "./pages/Beneficios";
import Contacto from "./pages/Contacto";
import ControlAcceso from "./pages/ControlAcceso"; // Importamos la app
import Disponibilidad from "./pages/Disponibilidad";
import Home from "./pages/Home";
import Login from "./pages/Login";
import MisReservas from "./pages/MisReservas";
import Perfil from "./pages/Perfil";
import Reservas from "./pages/Reservas";
import PagoExito from "./pages/PagoExito";
import PagoRechazado from "./pages/PagoRechazado";
import PagoPendiente from "./pages/PagoPendiente";
import { syncService } from "./services/syncService";
import { useEffect } from "react";

function App() {

  //Encendemos el motor de sincronización al cargar la App
  useEffect(() => {
    syncService.iniciarBackgroundSync();
  }, []);

  return (
    <BrowserRouter>
    {/* La sesión (token y rol) queda disponible para todo el árbol de rutas */}
    <AuthProvider>
      <Routes>
        {/* Panel de administración (Issue 15.1): es una app aparte, sin el Header ni el Footer de la web.
            Está protegido para ADMIN dentro de AdminRoutes y sus pantallas se registran en pages/admin/routes.tsx */}
        <Route path="/admin/*" element={<AdminRoutes />} />

        {/* Web de reservas: LayoutPublico pone el Header fijo arriba y el Footer al fondo */}
        <Route element={<LayoutPublico />}>
          {/* Rutas Públicas para Visitantes (Issue 9) */}
          <Route path="/" element={<Home />} />
          <Route path="/disponibilidad" element={<Disponibilidad />} />
          <Route path="/login" element={<Login />} />
          <Route path="/reservas" element={<Reservas />} />
          <Route path="/beneficios" element={<Beneficios />} />
          <Route path="/perfil" element={<Perfil />} />
          <Route path="/mis-reservas" element={<MisReservas />} />
          <Route path="/acerca" element={<Acerca />} />
          <Route path="/contacto" element={<Contacto />} />
          <Route path="/pago/exito" element={<PagoExito />} />
          <Route path="/pago/rechazado" element={<PagoRechazado />} />
          <Route path="/pago/pendiente" element={<PagoPendiente />} />

          {/* Ruta Oculta para Guardaparques (Issue 7) */}
          <Route path="/acceso" element={<ControlAcceso />} />
        </Route>
      </Routes>
    </AuthProvider>
    </BrowserRouter>
  );
}

export default App;