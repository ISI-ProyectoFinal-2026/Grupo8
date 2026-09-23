export function Footer() {
  return (
    <footer className="bg-zinc-900 text-zinc-300 py-10">
      <div className="container mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Horarios y Dirección */}
        <div>
          <h3 className="text-white text-lg font-semibold mb-4">Ubicación y Horarios</h3>
          <p className="text-sm mb-2">📍 San Rafael, Mendoza</p>
          <p className="text-sm">🕒 Lunes a Domingos: 08:00 a 22:00 hs</p>
        </div>

        {/* Contacto */}
        <div>
          <h3 className="text-white text-lg font-semibold mb-4">Contacto</h3>
          <p className="text-sm mb-2">📞 +54 9 260 412-3456</p>
          <p className="text-sm mb-2">✉️ somosqamp@gmail.com</p>
        </div>

        {/* Redes Sociales */}
        <div>
          <h3 className="text-white text-lg font-semibold mb-4">Seguinos</h3>
          <div className="flex space-x-4">
            <a href="#" className="hover:text-white transition-colors">Instagram</a>
            <a href="#" className="hover:text-white transition-colors">Facebook</a>
          </div>
        </div>
      </div>
      
      <div className="border-t border-zinc-800 mt-8 pt-6 text-center text-sm">
        <p>&copy; {new Date().getFullYear()} Qamp. Todos los derechos reservados.</p>
      </div>
    </footer>
  );
}