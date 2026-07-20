// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Creamos un componente súper simple acá mismo para la prueba
const ComponentePrueba = () => <h1>¡Frontend funcionando!</h1>;

describe('Test Base de React', () => {
  it('renderiza un componente simple en memoria sin fallar', () => {
    // 1. Renderizamos nuestro componente en la pantalla virtual
    render(<ComponentePrueba />);

    // 2. Buscamos que el título exista realmente en el documento
    const titulo = screen.getByText('¡Frontend funcionando!');
    expect(titulo).toBeDefined();
  });
});
