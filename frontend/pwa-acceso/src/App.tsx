import { BrowserRouter, Route, Routes } from "react-router-dom";
import { RutaProtegida } from "./components/auth/RutaProtegida";
import { RutaSocio } from "./components/auth/RutaSocio";
import { LayoutAcceso } from "./components/layout/LayoutAcceso";
import { LayoutPublico } from "./components/layout/LayoutPublico";
import { AuthProvider } from "./context/AuthContext";
import AdminRoutes from "./pages/admin/AdminRoutes";
import Acerca from "./pages/Acerca";
import Beneficios from "./pages/Beneficios";
import Contacto from "./pages/Contacto";
import ControlAcceso from "./pages/ControlAcceso"; 
import Disponibilidad from "./pages/Disponibilidad";
import Home from "./pages/Home";
import HistorialAcceso from "./pages/HistorialAcceso";
import EstadoSincronizacion from "./pages/EstadoSincronizacion";
import RegistroManual from "./pages/RegistroManual";
import Login from "./pages/Login";
import LoginAcceso from "./pages/LoginAcceso";
import MisReservas from "./pages/MisReservas";
import Perfil from "./pages/Perfil";
import Reservas from "./pages/Reservas";
import PagoExito from "./pages/PagoExito";
import PagoRechazado from "./pages/PagoRechazado";
import PagoPendiente from "./pages/PagoPendiente";
import PagarReserva from "./pages/PagarReserva";
import Arrepentimiento from "./pages/Arrepentimiento";
import CancelarReserva from "./pages/CancelarReserva";
import { syncService } from "./services/syncService";
import { LOGIN_POR_ROL } from "./lib/auth";
import { useEffect } from "react";
import { TituloDePagina } from "./components/TituloDePagina";

function App() {

  //Encendemos el motor de sincronización al cargar la App
  useEffect(() => {
    syncService.iniciarBackgroundSync();
  }, []);

  return (
    <BrowserRouter>
    {/* La sesión (token y rol) queda disponible para todo el árbol de rutas */}
    <AuthProvider>
      {/* Título de la pestaña según la pantalla (accesibilidad, 27.1) */}
      <TituloDePagina />
      <Routes>
        {/* Panel de administración: es una app aparte, sin el Header ni el Footer de la web.
            Tiene su propio login en /admin/login y su propio manifest. Está protegido para ADMIN
            dentro de AdminRoutes y sus pantallas se registran en pages/admin/routes.tsx */}
        <Route path="/admin/*" element={<AdminRoutes />} />

        {/* PWA de control de acceso: también es una app aparte, con su propio marco y su propio login.
            Solo entra el personal de SEGURIDAD */}
        <Route path="/acceso/login" element={<LoginAcceso />} />
        <Route element={<RutaProtegida roles={["SEGURIDAD"]} rutaLogin={LOGIN_POR_ROL.SEGURIDAD} />}>
          {/* Las cuatro pantallas comparten el marco y la barra inferior (26.4). Sin red funcionan
              igual: el service worker responde cualquier ruta con index.html y React Router elige la pantalla */}
          <Route element={<LayoutAcceso />}>
            <Route path="/acceso" element={<ControlAcceso />} />
            <Route path="/acceso/manual" element={<RegistroManual />} />
            <Route path="/acceso/historial" element={<HistorialAcceso />} />
            <Route path="/acceso/sincronizacion" element={<EstadoSincronizacion />} />
          </Route>
        </Route>

        {/* Web de reservas: LayoutPublico pone el Header fijo arriba y el Footer al fondo */}
        <Route element={<LayoutPublico />}>
          {/* Rutas Públicas para Visitantes */}
          <Route path="/" element={<Home />} />
          <Route path="/disponibilidad" element={<Disponibilidad />} />
          {/* Inicio de sesión de los socios */}
          <Route path="/login" element={<Login />} />
          <Route path="/reservas" element={<Reservas />} />
          <Route path="/reservas/pagar" element={<PagarReserva />} />
          <Route path="/beneficios" element={<Beneficios />} />
          <Route path="/acerca" element={<Acerca />} />
          <Route path="/contacto" element={<Contacto />} />
          <Route path="/pago/exito" element={<PagoExito />} />
          <Route path="/pago/rechazado" element={<PagoRechazado />} />
          <Route path="/pago/pendiente" element={<PagoPendiente />} />
          {/* Botón de arrepentimiento (25.3): sin sesión, como exige la Disposición 954/2025 */}
          <Route path="/arrepentimiento" element={<Arrepentimiento />} />
          <Route path="/cancelar-reserva" element={<CancelarReserva />} />

          {/* Solo para socios con sesión*/}
          <Route element={<RutaProtegida roles={["CLIENTE"]} />}>
            <Route element={<RutaSocio />}>
              <Route path="/perfil" element={<Perfil />} />
              <Route path="/mis-reservas" element={<MisReservas />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
    </BrowserRouter>
  );
}

export default App;