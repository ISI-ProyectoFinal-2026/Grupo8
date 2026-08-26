import { useEffect, useState } from 'react';
import { ScannerQR } from './components/ScannerQR';
import { dbService } from './services/dbService';
import { syncService } from './services/syncService';
import type { IJwtPayload } from './types/security';
import { verifyQRToken } from './utils/security';

function App() {
  // Estado nuevo: Indicadores de infraestructura
  const [ocupacion, setOcupacion] = useState<number>(0);
  const [capacidadMaxima, setCapacidadMaxima] = useState<number>(500);

  // Estado para controlar la visibilidad del componente de la cámara
  const [escaneando, setEscaneando] = useState<boolean>(false);
  
  // Estado para almacenar y renderizar el resultado del último escaneo
  const [resultadoValidacion, setResultadoValidacion] = useState<{
    exito: boolean;
    mensaje: string;
    payload?: IJwtPayload;
  } | null>(null);

  // ==========================================
  // NUEVO ESTADO ISSUE 7.4: Indicador de Sincronización
  // ==========================================
  const [syncStatus, setSyncStatus] = useState<{ estado: string; mensaje: string } | null>(null);

  // Inicialización de la infraestructura offline al montar la aplicación
  useEffect(() => {
    const inicializarDB = async () => {
      try {
        await dbService.guardarConfiguracion('version_app', '1.0.0');
        await dbService.guardarConfiguracion('capacidad_maxima', '500');
        
        const ocupacionActual = await dbService.obtenerOcupacion();
        const max = await dbService.obtenerCapacidadMaxima();
        
        setOcupacion(ocupacionActual);
        setCapacidadMaxima(max);

        await syncService.iniciarBackgroundSync();
      } catch (error) {
        console.error('❌ Error al inicializar IndexedDB:', error);
      }
    };
    
    inicializarDB();
  }, []);

  // ==========================================
  // NUEVO EFFECT ISSUE 7.4: Escuchador del Motor de Sincronización
  // ==========================================
  useEffect(() => {
    const handleSyncEvent = (e: any) => {
      const { estado, detalles } = e.detail;
      
      if (estado === 'iniciando' || estado === 'reintentando') {
        setSyncStatus({ 
          estado: 'warning', 
          mensaje: `⏳ Sincronizando ${detalles.cantidad} registros pendientes...` 
        });
      } else if (estado === 'completado') {
        setSyncStatus({ 
          estado: 'success', 
          mensaje: `✅ ¡Datos Actualizados! (${detalles.cantidad} enviados)` 
        });
        // El cartel verde desaparece solo a los 4 segundos
        setTimeout(() => setSyncStatus(null), 4000); 
      } else if (estado === 'error') {
        setSyncStatus({ 
          estado: 'error', 
          mensaje: `⚠️ ${detalles.mensaje}` 
        });
        setTimeout(() => setSyncStatus(null), 5000);
      }
    };

    // Prendemos la oreja para escuchar al syncService
    window.addEventListener('sync-status', handleSyncEvent);
    
    // Limpieza de memoria (buena práctica en React)
    return () => window.removeEventListener('sync-status', handleSyncEvent);
  }, []);

  const procesarQR = async (token: string) => {
    navigator.vibrate?.(200); 
    setEscaneando(false); 
    
    const payload = await verifyQRToken(token);

    if (!payload) {
      setResultadoValidacion({
        exito: false,
        mensaje: '❌ Acceso Denegado: Código QR inválido, alterado o expirado.'
      });
      return; 
    }

    try {
      await dbService.registrarIngresoOffline(payload.jti, payload);
      setOcupacion(prev => prev + payload.cantidad_personas);
      setResultadoValidacion({
        exito: true,
        mensaje: `✅ INGRESO CONFIRMADO (${payload.typ.toUpperCase()})`,
        payload: payload
      });
    } catch (error: any) {
      setResultadoValidacion({
        exito: false,
        mensaje: `❌ Acceso Denegado: ${error.message}`
      });
    }
  };

  const lugaresDisponibles = capacidadMaxima - ocupacion;
  const porcentajeOcupacion = (ocupacion / capacidadMaxima) * 100;

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center' }}>Sistema de Acceso - Grupo 8</h1>
      
      {/* ========================================== */}
      {/* NUEVO CARTEL ISSUE 7.4 (Bloqueo visual discreto) */}
      {/* ========================================== */}
      {syncStatus && (
        <div style={{ 
          backgroundColor: syncStatus.estado === 'warning' ? '#fff3cd' : syncStatus.estado === 'success' ? '#d4edda' : '#f8d7da',
          color: syncStatus.estado === 'warning' ? '#856404' : syncStatus.estado === 'success' ? '#155724' : '#721c24',
          padding: '12px', 
          borderRadius: '5px', 
          textAlign: 'center', 
          marginBottom: '15px', 
          fontWeight: 'bold', 
          border: '1px solid',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          {syncStatus.mensaje}
        </div>
      )}

      {/* Panel de Estadísticas en Tiempo Real */}
      <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #dee2e6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ margin: 0, fontSize: '14px', color: '#6c757d' }}>Capacidad Disponible</p>
          <h2 style={{ margin: '5px 0 0 0', color: lugaresDisponibles < 20 ? '#dc3545' : '#28a745' }}>
            {lugaresDisponibles} <span style={{ fontSize: '16px' }}>/ {capacidadMaxima}</span>
          </h2>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: 0, fontSize: '14px', color: '#6c757d' }}>Ocupación</p>
          <p style={{ margin: '5px 0 0 0', fontWeight: 'bold' }}>{porcentajeOcupacion.toFixed(1)}%</p>
        </div>
      </div>
      
      <div style={{ textAlign: 'center', marginTop: '30px' }}>
        {!escaneando ? (
          <button 
            onClick={() => {
              setResultadoValidacion(null);
              setEscaneando(true);
            }}
            disabled={lugaresDisponibles <= 0} 
            style={{ 
              padding: '15px 30px', 
              fontSize: '18px', 
              backgroundColor: lugaresDisponibles <= 0 ? '#6c757d' : '#0056b3', 
              color: 'white', border: 'none', borderRadius: '8px', 
              cursor: lugaresDisponibles <= 0 ? 'not-allowed' : 'pointer', 
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              width: '100%'
            }}
          >
            {lugaresDisponibles <= 0 ? '🛑 CAMPING LLENO' : '📸 Escanear QR'}
          </button>
        ) : (
          <div>
            <h3 style={{ marginBottom: '15px' }}>Apunte al código del visitante</h3>
            <ScannerQR onScanSuccess={procesarQR} />
            <button 
              onClick={() => setEscaneando(false)}
              style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '8px' }}
            >
              Cancelar Escaneo
            </button>
          </div>
        )}
      </div>

      {resultadoValidacion && (
        <div style={{ 
          marginTop: '30px', 
          padding: '20px', 
          backgroundColor: resultadoValidacion.exito ? '#d4edda' : '#f8d7da', 
          border: `2px solid ${resultadoValidacion.exito ? '#28a745' : '#dc3545'}`,
          borderRadius: '8px',
          color: resultadoValidacion.exito ? '#155724' : '#721c24',
          textAlign: 'center'
        }}>
          <h2>{resultadoValidacion.mensaje}</h2>
          
          {resultadoValidacion.exito && resultadoValidacion.payload && (
            <div style={{ fontSize: '15px', marginTop: '15px', textAlign: 'left', display: 'inline-block', backgroundColor: 'rgba(255,255,255,0.5)', padding: '10px', borderRadius: '8px' }}>
              <p><strong>N° Reserva:</strong> {resultadoValidacion.payload.reserva_id}</p>
              <p><strong>Camping ID:</strong> {resultadoValidacion.payload.camping_id}</p>
              <p><strong>Personas Autorizadas:</strong> {resultadoValidacion.payload.cantidad_personas}</p>
              <p><strong>Fecha Válida:</strong> {resultadoValidacion.payload.dat}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;