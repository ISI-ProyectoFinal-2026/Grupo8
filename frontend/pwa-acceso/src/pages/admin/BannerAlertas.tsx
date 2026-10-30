import { Link } from 'react-router-dom';
import { useAlertas } from '@/hooks/useAlertas';

export function BannerAlertas() {
  const { alertas, estado, error } = useAlertas();

  if (estado === 'cargando') {
    return <div role="status" style={{ padding: 12 }}>Revisando alertas de acceso…</div>;
  }
  if (estado === 'error') {
    return (
      <div role="status" style={{ padding: 12, background: '#eee', borderRadius: 8 }}>
        {`No se pudieron consultar las alertas de acceso. ${error ?? ''}`}
      </div>
    );
  }
  if (estado === 'vacio') {
    return (
      <div role="status" style={{ padding: 12, background: '#e6f4e6', borderRadius: 8 }}>
        Sin incidentes de acceso pendientes.
      </div>
    );
  }

  const cantidad = alertas.length;
  return (
    <div role="alert" style={{ padding: 16, background: '#fff3cd', border: '1px solid #f0ad4e', borderRadius: 8 }}>
      <strong>{`⚠️ ${cantidad} incidente${cantidad === 1 ? '' : 's'} de acceso sin resolver`}</strong>
      <p style={{ margin: '8px 0' }}>
        {`Intento de múltiple ingreso detectado para el titular ${alertas[0].titular}`}
        {cantidad > 1 ? ` y ${cantidad - 1} más.` : ''}
      </p>
      <Link to="/admin/alertas">Ver alertas</Link>
    </div>
  );
}