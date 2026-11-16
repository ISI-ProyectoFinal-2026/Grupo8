import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Footer } from './Footer';
import { Header } from './Header';

const ID_CONTENIDO = 'contenido';

/** Marco de la web de reservas: encabezado arriba, contenido en el medio y pie abajo. */
export function LayoutPublico() {
  const { pathname } = useLocation();
  const contenido = useRef<HTMLElement>(null);
  const primeraPantalla = useRef(true);

  // Al cambiar de pantalla el foco pasa al contenido nuevo, como al abrir una página.
  // Si no, quien usa teclado o lector de pantalla queda en el enlace que tocó, en la pantalla anterior.
  // En la primera pantalla no se mueve: el navegador ya empieza desde arriba
  useEffect(() => {
    if (primeraPantalla.current) {
      primeraPantalla.current = false;
      return;
    }
    contenido.current?.focus({ preventScroll: true });
    window.scrollTo?.(0, 0);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Primer elemento al usar Tab: salta el encabezado y lleva directo al contenido (WCAG 2.4.1) */}
      <a
        href={`#${ID_CONTENIDO}`}
        // Se mueve el foco a mano para no sumar "#contenido" a la dirección ni al historial
        onClick={(e) => {
          e.preventDefault();
          contenido.current?.focus();
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:font-medium focus:text-foreground focus:shadow-md"
      >
        Saltar al contenido
      </a>

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
