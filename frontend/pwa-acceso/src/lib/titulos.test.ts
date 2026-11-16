import { describe, expect, it } from 'vitest';
import { tituloDeRuta } from './titulos';

describe('tituloDeRuta', () => {
  it('da un título propio a cada pantalla de la web de reservas', () => {
    expect(tituloDeRuta('/')).toBe('Inicio | Qamp');
    expect(tituloDeRuta('/reservas')).toBe('Completá tu reserva | Qamp');
    expect(tituloDeRuta('/mis-reservas')).toBe('Mis reservas | Qamp');
    expect(tituloDeRuta('/arrepentimiento')).toBe(
      'Botón de arrepentimiento | Qamp'
    );
  });

  it('usa el nombre de la PWA en las pantallas del guardia', () => {
    expect(tituloDeRuta('/acceso')).toBe('Escáner | Qamp Acceso');
    expect(tituloDeRuta('/acceso/historial')).toBe('Historial | Qamp Acceso');
  });

  it('toma los títulos del panel del mismo registro que arma el menú', () => {
    expect(tituloDeRuta('/admin')).toBe('Inicio | Qamp Panel');
    expect(tituloDeRuta('/admin/reservas')).toBe(
      'Gestión de reservas | Qamp Panel'
    );
    expect(tituloDeRuta('/admin/login')).toBe('Ingreso al panel | Qamp Panel');
  });

  it('ignora la barra final', () => {
    expect(tituloDeRuta('/mis-reservas/')).toBe('Mis reservas | Qamp');
  });

  it('si la ruta no tiene título propio, deja solo el nombre de la app', () => {
    expect(tituloDeRuta('/no-existe')).toBe('Qamp');
    expect(tituloDeRuta('/acceso/no-existe')).toBe('Qamp Acceso');
    expect(tituloDeRuta('/admin/no-existe')).toBe('Qamp Panel');
  });

  it('no confunde rutas que solo empiezan igual', () => {
    expect(tituloDeRuta('/accesorios')).toBe('Qamp');
    expect(tituloDeRuta('/administracion')).toBe('Qamp');
  });
});
