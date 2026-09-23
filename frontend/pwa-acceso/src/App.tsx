import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Footer } from "./components/layout/Footer";
import { Header } from "./components/layout/Header";
import Beneficios from "./pages/Beneficios";
import ControlAcceso from "./pages/ControlAcceso"; // Importamos la app
import Disponibilidad from "./pages/Disponibilidad";
import Home from "./pages/Home";
import Login from "./pages/Login";
import MisReservas from "./pages/MisReservas";
import Perfil from "./pages/Perfil";
import Reservas from "./pages/Reservas";

function App() {
  return (
    <BrowserRouter>
    {/* El Header se renderiza en todas las páginas, y queda fijo arriba */}
      <Header />
      
      {/* Main envuelve el contenido central para que empuje al footer hacia abajo si hay poco contenido */}
      <main className="min-h-[calc(100vh-4rem-15rem)]">
      <Routes>
        {/* Rutas Públicas para Visitantes (Issue 9) */}
        <Route path="/" element={<Home />} />
        <Route path="/disponibilidad" element={<Disponibilidad />} />
        <Route path="/login" element={<Login />} />
        <Route path="/reservas" element={<Reservas />} />
        <Route path="/beneficios" element={<Beneficios />} />
        <Route path="/perfil" element={<Perfil />} />
        <Route path="/mis-reservas" element={<MisReservas />} />
        
        {/* Ruta Oculta para Guardaparques (Issue 7) */}
        <Route path="/acceso" element={<ControlAcceso />} />
      </Routes>
      </main>

      {/* El Footer se renderiza al fondo de todas las páginas */}
      <Footer />
    </BrowserRouter>
  );
}

export default App;