import { MonitorOcupacion } from '@/components/admin/MonitorOcupacion';
import { useOcupacion } from '@/hooks/useOcupacion';

export default function Inicio() {
  const { ocupacion, estado, error, recargar } = useOcupacion();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-900">Inicio</h1>
      <MonitorOcupacion ocupacion={ocupacion} estado={estado} error={error} recargar={recargar} />
    </div>
  );
}