// Datos del camping que contrató Qamp. La web de reservas muestra el nombre y los datos de
// contacto del camping, no los de Qamp. Se configuran en el .env del frontend (ver .env.example);
// los que quedan vacíos no se muestran.

function leer(valor: string | undefined): string {
  return (valor ?? '').trim();
}

export const CAMPING = {
  nombre: leer(import.meta.env.VITE_CAMPING_NOMBRE) || 'Camping',
  email: leer(import.meta.env.VITE_CAMPING_EMAIL),
  telefono: leer(import.meta.env.VITE_CAMPING_TELEFONO),
  direccion: leer(import.meta.env.VITE_CAMPING_DIRECCION),
  // Un renglón por franja horaria, separadas por "|": "Lunes a sábados 8:00 a 20:00|Domingos 8:00 a 22:30"
  horarios: leer(import.meta.env.VITE_CAMPING_HORARIOS)
    .split('|')
    .map((franja) => franja.trim())
    .filter(Boolean),
  instagram: leer(import.meta.env.VITE_CAMPING_INSTAGRAM),
  facebook: leer(import.meta.env.VITE_CAMPING_FACEBOOK),
} as const;
