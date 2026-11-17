import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Al cambiar de pantalla, el foco pasa al contenido nuevo, como al abrir una página.
 * Si no, quien usa teclado o lector de pantalla queda en el enlace que tocó, en la pantalla
 * anterior. En la primera pantalla no se mueve: el navegador ya empieza desde arriba.
 *
 * Devuelve la ref para el contenedor del contenido (`<main>`), que necesita tabIndex={-1}.
 * Lo usan el marco de la web de reservas (27.2) y el del panel (27.3).
 */
export function useFocoAlCambiarDePantalla<T extends HTMLElement>() {
  const { pathname } = useLocation();
  const contenido = useRef<T>(null);
  const primeraPantalla = useRef(true);

  useEffect(() => {
    if (primeraPantalla.current) {
      primeraPantalla.current = false;
      return;
    }
    contenido.current?.focus({ preventScroll: true });
    window.scrollTo?.(0, 0);
  }, [pathname]);

  return contenido;
}
