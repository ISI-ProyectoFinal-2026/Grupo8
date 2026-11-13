// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useManifest } from './useManifest';

function ConManifest({ href }: { href: string }) {
  useManifest(href);
  return null;
}

const linkManifest = () => document.querySelector<HTMLLinkElement>('link[rel="manifest"]');

describe('useManifest', () => {
  afterEach(() => {
    cleanup();
    document.head.innerHTML = '';
  });

  it('reemplaza el manifest general y lo vuelve a poner al desmontarse', () => {
    const general = document.createElement('link');
    general.rel = 'manifest';
    general.href = '/manifest.webmanifest';
    document.head.appendChild(general);

    const { unmount } = render(<ConManifest href="/manifest-admin.webmanifest" />);
    expect(linkManifest()?.getAttribute('href')).toBe('/manifest-admin.webmanifest');
    expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(1);

    unmount();
    expect(linkManifest()?.getAttribute('href')).toBe('/manifest.webmanifest');
  });

  it('si no había manifest lo crea y después lo quita', () => {
    const { unmount } = render(<ConManifest href="/manifest-admin.webmanifest" />);
    expect(linkManifest()?.getAttribute('href')).toBe('/manifest-admin.webmanifest');

    unmount();
    expect(linkManifest()).toBeNull();
  });
});
