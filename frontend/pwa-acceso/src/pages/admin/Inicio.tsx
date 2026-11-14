import { MonitorOcupacion } from '@/components/admin/MonitorOcupacion';
import { PersonasEsperadas } from '@/components/admin/PersonasEsperadas';
import { ResumenCobros } from '@/components/admin/ResumenCobros';
import { useOcupacion } from '@/hooks/useOcupacion';

export default function Inicio() {
  const { ocupacion, estado, error, recargar } = useOcupacion();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-900">Inicio</h1>
      {/* Las personas esperadas van al lado de la ocupación, pero separadas: todavía no entraron */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <MonitorOcupacion ocupacion={ocupacion} estado={estado} error={error} recargar={recargar} />
        <PersonasEsperadas />
      </div>
      <ResumenCobros />
    </div>
  );
}
