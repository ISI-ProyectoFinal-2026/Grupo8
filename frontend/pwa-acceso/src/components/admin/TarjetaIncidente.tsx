import { useState } from 'react';
import { mensajeDeError, type AlertaClonacion } from '@/services/alertasService';

interface Props {
  alerta: AlertaClonacion;
  onResolver: (alerta: AlertaClonacion, nota: string) => Promise<void>;
}

const formatearFechaHora = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : 'sin fecha registrada';

// La fecha de ingreso viene sin hora: se da vuelta el texto y no se pasa por Date, para que la zona horaria no la corra un día
const formatearFecha = (iso: string): string => iso.split('-').reverse().join('/');

export function TarjetaIncidente({ alerta, onResolver }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idNota = `nota-${alerta.reserva_id}`;

  const confirmar = async (): Promise<void> => {
    setEnviando(true);
    setError(null);
    try {
      await onResolver(alerta, nota);
      setConfirmando(false);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <article style={{ border: '1px solid #f0ad4e', background: '#fff8e5', borderRadius: 8, padding: 16 }}>
      <p style={{ margin: 0, fontWeight: 'bold', color: '#8a5a00' }}>
        {`Intento de múltiple ingreso detectado para el titular ${alerta.titular}`}
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 14 }}>
        {`Reserva #${alerta.reserva_id.slice(0, 8)} · ingreso ${formatearFecha(alerta.fecha_ingreso)}`}
      </p>
      <p style={{ margin: '4px 0 0', fontSize: 14 }}>
        {`Detectado el ${formatearFechaHora(alerta.fecha_alerta_clonacion)}`}
      </p>

      {!confirmando ? (
        <button type="button" onClick={() => setConfirmando(true)} style={{ marginTop: 12 }}>
          Resolver incidente
        </button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 8px' }}>
            Confirmá solo si ya verificaste la situación en la puerta. La reserva vuelve a su estado anterior y sale del listado.
          </p>
          <label htmlFor={idNota} style={{ display: 'block', marginBottom: 4 }}>
            Nota (opcional)
          </label>
          <textarea
            id={idNota}
            value={nota}
            maxLength={500}
            disabled={enviando}
            onChange={(e) => setNota(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          {error && <p role="alert" style={{ color: '#a94442' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" disabled={enviando} onClick={() => void confirmar()}>
              {enviando ? 'Resolviendo…' : 'Confirmar resolución'}
            </button>
            <button type="button" disabled={enviando} onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </article>
  );
}