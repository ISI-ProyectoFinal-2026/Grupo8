import { useEffect } from 'react';

/**
 * Mientras el componente está montado, la página usa el manifest indicado en lugar del general.
 * Al desmontarse deja el manifest que había antes. En desarrollo vite-plugin-pwa no agrega el
 * <link rel="manifest">, así que si no existe se crea y después se quita.
 */
export function useManifest(href: string) {
  useEffect(() => {
    const existente = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const link = existente ?? document.createElement('link');
    const anterior = existente?.getAttribute('href') ?? null;

    if (!existente) {
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    link.setAttribute('href', href);

    return () => {
      if (!existente) link.remove();
      else if (anterior !== null) link.setAttribute('href', anterior);
    };
  }, [href]);
}
