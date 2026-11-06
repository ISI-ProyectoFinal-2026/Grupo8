import { FormularioEgreso } from '@/components/admin/FormularioEgreso';
import { MonitorOcupacion } from '@/components/admin/MonitorOcupacion';
import { useOcupacion } from '@/hooks/useOcupacion';

export default function Egresos() {
  const { ocupacion, estado, error, recargar } = useOcupacion();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-900">Egresos</h1>
      <MonitorOcupacion ocupacion={ocupacion} estado={estado} error={error} recargar={recargar} />
      <FormularioEgreso
        personasDentro={ocupacion?.ocupacion_actual ?? null}
        onRegistrado={recargar}
      />
    </div>
  );
}