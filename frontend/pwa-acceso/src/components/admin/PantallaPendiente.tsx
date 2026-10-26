interface PantallaPendienteProps {
  titulo: string;
}

/** Contenido provisional de las pantallas del panel; cada responsable lo reemplaza por su pantalla. */
export function PantallaPendiente({ titulo }: PantallaPendienteProps) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900">{titulo}</h1>
      <p className="mt-1 text-zinc-600">Pantalla pendiente de implementación.</p>
    </div>
  );
}