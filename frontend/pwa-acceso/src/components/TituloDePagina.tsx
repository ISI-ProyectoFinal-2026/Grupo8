import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { tituloDeRuta } from '@/lib/titulos';

/**
 * Cambia el título de la pestaña en cada navegación. En una SPA el navegador no lo cambia
 * solo, y es lo primero que anuncia un lector de pantalla al llegar a una pantalla nueva.
 * Va una sola vez en App.tsx, así las pantallas no tienen que acordarse de hacerlo.
 */
export function TituloDePagina() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = tituloDeRuta(pathname);
  }, [pathname]);

  return null;
}
