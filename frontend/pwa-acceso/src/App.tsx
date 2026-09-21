import { BrowserRouter, Route, Routes } from "react-router-dom";
import Beneficios from "./pages/Beneficios";
import ControlAcceso from "./pages/ControlAcceso"; // Importamos la app de guardaparques
import Home from "./pages/Home";
import Login from "./pages/Login";
import Reservas from "./pages/Reservas";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rutas Públicas para Visitantes (Issue 9) */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/reservas" element={<Reservas />} />
        <Route path="/beneficios" element={<Beneficios />} />
        
        {/* Ruta Oculta para Guardaparques (Issue 7) */}
        <Route path="/acceso" element={<ControlAcceso />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;