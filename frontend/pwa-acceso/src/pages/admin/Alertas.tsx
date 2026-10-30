import { useState } from 'react';
import { TarjetaIncidente } from '@/components/admin/TarjetaIncidente';
import { useAlertas } from '@/hooks/useAlertas';
import { AlertasApiError, type AlertaClonacion } from '@/services/alertasService';

export function Alertas() {
  const { alertas, estado, error, actualizando, recargar, resolver } = useAlertas();
  const [aviso, setAviso] = useState<string | null>(null);

  const manejarResolver = async (alerta: AlertaClonacion, nota: string): Promise<void> => {
    try {
      await resolver(alerta.reserva_id, nota);
      setAviso(`Incidente de ${alerta.titular} resuelto.`);
    } catch (e) {
      if (e instanceof AlertasApiError && e.status === 409) {
        setAviso('Ese incidente ya había sido resuelto por otro administrador. Se actualizó el listado.');
        return;
      }
      throw e; // el resto de los errores los muestra la tarjeta
    }
  };

  return (
    <section aria-labelledby="titulo-alertas" style={{ padding: 20, maxWidth: 800 }}>
      <h1 id="titulo-alertas">Alertas de acceso</h1>

      {aviso && <p role="status" style={{ color: '#2b6b2b' }}>{aviso}</p>}
      {actualizando && estado !== 'cargando' && (
        <p role="status" style={{ fontSize: 13, color: '#666' }}>Actualizando…</p>
      )}

      {estado === 'cargando' && <p role="status">Cargando alertas…</p>}

      {estado === 'error' && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void recargar()}>Reintentar</button>
        </div>
      )}

      {estado === 'vacio' && (
        <p style={{ color: '#2b6b2b' }}>No hay incidentes pendientes. Todos los accesos están en orden.</p>
      )}

      {estado === 'listo' && (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
          {alertas.map((alerta) => (
            <li key={alerta.reserva_id}>
              <TarjetaIncidente alerta={alerta} onResolver={manejarResolver} />
            </li>
          ))}
        </ul>
      )}

      {/* Si el listado ya estaba cargado y falla una actualización, no se tira lo que se ve */}
      {(estado === 'listo' || estado === 'vacio') && error && (
        <p role="alert" style={{ color: '#a94442' }}>{`No se pudo actualizar el listado: ${error}`}</p>
      )}
    </section>
  );
}