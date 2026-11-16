import { Outlet } from 'react-router-dom';
import { Footer } from './Footer';
import { Header } from './Header';

/** Marco de la web de reservas: encabezado arriba, contenido en el medio y pie abajo. */
export function LayoutPublico() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      {/* El contenido crece y empuja el pie hacia abajo; las montañas quedan detrás, al fondo */}
      <main className="relative flex-1 pb-32">
        <div className="fondo-montanas" aria-hidden="true" />
        <div className="relative">
          <Outlet />
        </div>
      </main>

      <Footer />
    </div>
  );
}
