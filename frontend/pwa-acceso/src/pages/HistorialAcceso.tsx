import { History } from 'lucide-react';

/**
 * Historial de la app del guardia (/acceso/historial). Por ahora es la pantalla vacía:
 * la Sub-issue 26.2 le suma los últimos ingresos del dispositivo, guardados en la tabla
 * `historial` de IndexedDB, con su estado de sincronización.
 */
export default function HistorialAcceso() {
  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <h1 className="text-center text-2xl font-semibold text-foreground">Historial</h1>

      <section
        aria-labelledby="historial-vacio"
        className="flex flex-col items-center gap-3 rounded-3xl border border-tierra-200/70 bg-white px-6 py-10 text-center shadow-sm"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-tierra-800">
          <History className="h-7 w-7" aria-hidden="true" />
        </span>
        <h2 id="historial-vacio" className="text-lg font-semibold text-foreground">
          Próximamente
        </h2>
        <p className="max-w-sm text-base text-muted-foreground">
          Acá vas a ver los últimos ingresos registrados en este dispositivo y si ya se
          sincronizaron con el servidor.
        </p>
      </section>
    </div>
  );
}
