import { Outlet } from 'react-router-dom';
import { Footer } from './Footer';
import { Header } from './Header';

/** Marco de la web de reservas: encabezado arriba, contenido en el medio y pie abajo. */
export function LayoutPublico() {
  return (
    <>
      <Header />

      {/* Main envuelve el contenido central para que empuje al footer hacia abajo si hay poco contenido */}
      <main className="min-h-[calc(100vh-4rem-15rem)]">
        <Outlet />
      </main>

      <Footer />
    </>
  );
}