import { Outlet } from 'react-router-dom';
import { useFocoAlCambiarDePantalla } from '@/hooks/useFocoAlCambiarDePantalla';
import { Footer } from './Footer';
import { Header } from './Header';
import { SaltarAlContenido } from './SaltarAlContenido';

const ID_CONTENIDO = 'contenido';

/** Marco de la web de reservas: encabezado arriba, contenido en el medio y pie abajo. */
export function LayoutPublico() {
  const contenido = useFocoAlCambiarDePantalla<HTMLElement>();

  return (
    <div className="flex min-h-screen flex-col">
      <SaltarAlContenido destino={contenido} idDestino={ID_CONTENIDO} />

      <Header />

      {/* El contenido crece y empuja el pie hacia abajo; las montañas quedan detrás, al fondo.
          tabIndex={-1}: recibe el foco desde "Saltar al contenido" y al cambiar de pantalla */}
      <main
        id={ID_CONTENIDO}
        ref={contenido}
        tabIndex={-1}
        className="relative flex-1 pb-32 focus:outline-none"
      >
        <div className="fondo-montanas" aria-hidden="true" />
        <div className="relative">
          <Outlet />
        </div>
      </main>

      <Footer />
    </div>
  );
}
