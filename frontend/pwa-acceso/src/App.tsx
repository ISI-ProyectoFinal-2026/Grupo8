import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { ScannerQR } from './components/ScannerQR';
import { dbService } from './services/dbService';
import { syncService } from './services/syncService';
import type { IJwtPayload } from './types/security';
import { verifyQRToken } from './utils/security';

function App() {
  const [ocupacion, setOcupacion] = useState<number>(0);
  const [capacidadMaxima, setCapacidadMaxima] = useState<number>(500);
  const [escaneando, setEscaneando] = useState<boolean>(false);
  const [resultadoValidacion, setResultadoValidacion] = useState<{
    exito: boolean;
    mensaje: string;
    payload?: IJwtPayload | any;
  } | null>(null);

  // ==========================================
  // ESTADOS ISSUE 7.3: INGRESO MANUAL
  // ==========================================
  const [mostrarFormulario, setMostrarFormulario] = useState<boolean>(false);
  const [formDni, setFormDni] = useState('');
  const [formNombre, setFormNombre] = useState('');
  const [formAcompanantes, setFormAcompanantes] = useState(0);
  const [formTipo, setFormTipo] = useState('Espontaneo');

  // ==========================================
  // ESTADO ISSUE 7.1: PANEL QA
  // ==========================================
  const [idABloquear, setIdABloquear] = useState('');

  // ==========================================
  // ESTADO ISSUE 7.4: INDICADOR DE SINCRONIZACIÓN
  // ==========================================
  const [syncStatus, setSyncStatus] = useState<{ estado: string; mensaje: string } | null>(null);

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
  // ISSUE 7.4: ESCUCHADOR DEL MOTOR DE SINCRONIZACIÓN
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
        setTimeout(() => setSyncStatus(null), 4000); 
      } else if (estado === 'error') {
        setSyncStatus({ 
          estado: 'error', 
          mensaje: `⚠️ ${detalles.mensaje}` 
        });
        setTimeout(() => setSyncStatus(null), 5000);
      }
    };

    window.addEventListener('sync-status', handleSyncEvent);
    return () => window.removeEventListener('sync-status', handleSyncEvent);
  }, []);

  const procesarQR = async (token: string) => {
    navigator.vibrate?.(200); 
    setEscaneando(false); 
    
    const payload = await verifyQRToken(token);

    if (!payload) {
      setResultadoValidacion({ exito: false, mensaje: '❌ Acceso Denegado: Código QR inválido.' });
      return; 
    }

    try {
      // ==========================================
      // ISSUE 7.1: Validación de Lista Negra (Lupa)
      // ==========================================
      const estaRevocado = await dbService.verificarAccesoRevocado(payload.reserva_id.toString());
      if (estaRevocado) {
        setResultadoValidacion({
          exito: false,
          mensaje: '⚠️ Reserva Cancelada / Acceso Revocado'
        });
        return; 
      }

      await dbService.registrarIngresoOffline(payload.jti, payload);
      setOcupacion(prev => prev + payload.cantidad_personas);
      setResultadoValidacion({
        exito: true,
        mensaje: `✅ INGRESO CONFIRMADO (${payload.typ.toUpperCase()})`,
        payload: payload
      });
    } catch (error: any) {
      setResultadoValidacion({ exito: false, mensaje: `❌ Acceso Denegado: ${error.message}` });
    }
  };

  // ==========================================
  // ISSUE 7.3: PROCESAR FORMULARIO MANUAL
  // ==========================================
  const handleIngresoManual = async (e: FormEvent) => {
    e.preventDefault(); 
    
    if (!formDni.trim() || !formNombre.trim()) {
      alert("⚠️ Por favor, complete el DNI y Nombre del visitante.");
      return;
    }

    try {
      await dbService.registrarIngresoManual(formDni, formNombre, formAcompanantes, formTipo);
      
      const totalIngresan = formAcompanantes + 1; 
      setOcupacion(prev => prev + totalIngresan);
      
      setResultadoValidacion({
        exito: true,
        mensaje: `✅ INGRESO MANUAL REGISTRADO (${formTipo.toUpperCase()})`,
        payload: { dni: formDni, nombre: formNombre, cantidad_personas: totalIngresan }
      });

      setFormDni('');
      setFormNombre('');
      setFormAcompanantes(0);
      setFormTipo('Espontaneo');
      setMostrarFormulario(false);

    } catch (error: any) {
      setResultadoValidacion({
        exito: false,
        mensaje: `❌ Error de ingreso: ${error.message}`
      });
    }
  };

  const lugaresDisponibles = capacidadMaxima - ocupacion;
  const porcentajeOcupacion = (ocupacion / capacidadMaxima) * 100;

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center' }}>Sistema de Acceso - Grupo 8</h1>
      
      {/* ========================================== */}
      {/* ISSUE 7.4: CARTEL DE SINCRONIZACIÓN */}
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
        {/* Renderizado condicional combinado */}
        {!escaneando && !mostrarFormulario ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <button 
              onClick={() => { setResultadoValidacion(null); setEscaneando(true); }}
              disabled={lugaresDisponibles <= 0} 
              style={{ padding: '15px', fontSize: '18px', backgroundColor: lugaresDisponibles <= 0 ? '#6c757d' : '#0056b3', color: 'white', border: 'none', borderRadius: '8px', cursor: lugaresDisponibles <= 0 ? 'not-allowed' : 'pointer' }}
            >
              {lugaresDisponibles <= 0 ? '🛑 CAMPING LLENO' : '📸 Escanear QR'}
            </button>
            
            <button 
              onClick={() => { setResultadoValidacion(null); setMostrarFormulario(true); }}
              disabled={lugaresDisponibles <= 0} 
              style={{ padding: '15px', fontSize: '18px', backgroundColor: lugaresDisponibles <= 0 ? '#6c757d' : '#28a745', color: 'white', border: 'none', borderRadius: '8px', cursor: lugaresDisponibles <= 0 ? 'not-allowed' : 'pointer' }}
            >
              📝 Ingreso Manual (Contingencia)
            </button>
          </div>
        ) : escaneando ? (
          <div>
            <h3 style={{ marginBottom: '15px' }}>Apunte al código del visitante</h3>
            <ScannerQR onScanSuccess={procesarQR} />
            <button onClick={() => setEscaneando(false)} style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '8px' }}>Cancelar</button>
          </div>
        ) : (
          <form onSubmit={handleIngresoManual} style={{ textAlign: 'left', backgroundColor: '#fdfdfd', padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
            <h3 style={{ marginTop: 0 }}>Registro Manual de Ingreso</h3>
            
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>DNI / Pasaporte:</label>
              <input type="text" value={formDni} onChange={e => setFormDni(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }} required />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Nombre completo:</label>
              <input type="text" value={formNombre} onChange={e => setFormNombre(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }} required />
            </div>

            <div style={{ marginBottom: '15px', display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Acompañantes:</label>
                <input type="number" min="0" value={formAcompanantes} onChange={e => setFormAcompanantes(parseInt(e.target.value) || 0)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Tipo de Ingreso:</label>
                <select value={formTipo} onChange={e => setFormTipo(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}>
                  <option value="Espontaneo">Espontáneo (Sin reserva)</option>
                  <option value="Manual con Reserva">Manual con Reserva</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button type="submit" style={{ flex: 1, padding: '10px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Guardar Ingreso</button>
              <button type="button" onClick={() => setMostrarFormulario(false)} style={{ padding: '10px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancelar</button>
            </div>
          </form>
        )}
      </div>

      {resultadoValidacion && (
        <div style={{ marginTop: '30px', padding: '20px', backgroundColor: resultadoValidacion.exito ? '#d4edda' : '#f8d7da', border: `2px solid ${resultadoValidacion.exito ? '#28a745' : '#dc3545'}`, borderRadius: '8px', color: resultadoValidacion.exito ? '#155724' : '#721c24', textAlign: 'center' }}>
          <h2>{resultadoValidacion.mensaje}</h2>
          {resultadoValidacion.exito && resultadoValidacion.payload && (
            <div style={{ fontSize: '15px', marginTop: '15px', textAlign: 'left', display: 'inline-block', backgroundColor: 'rgba(255,255,255,0.5)', padding: '10px', borderRadius: '8px' }}>
              {resultadoValidacion.payload.dni && <p><strong>DNI/ID:</strong> {resultadoValidacion.payload.dni}</p>}
              {resultadoValidacion.payload.nombre && <p><strong>Nombre:</strong> {resultadoValidacion.payload.nombre}</p>}
              <p><strong>Personas Ingresadas:</strong> {resultadoValidacion.payload.cantidad_personas}</p>
            </div>
          )}
        </div>
      )}

      {/* ========================================== */}
      {/* ISSUE 7.1: PANEL DE PRUEBAS PARA QA */}
      {/* ========================================== */}
      <div style={{ marginTop: '50px', padding: '15px', border: '2px dashed #ccc', borderRadius: '8px', backgroundColor: '#fdfdfd' }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#666' }}>🛠️ Panel de Pruebas (Issue 7.1)</h4>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input 
            type="text" 
            placeholder="N° de reserva a bloquear..." 
            value={idABloquear}
            onChange={(e) => setIdABloquear(e.target.value)}
            style={{ padding: '8px', flex: 1 }}
          />
          <button 
            onClick={async () => {
              if(!idABloquear) return;
              await dbService.agregarABlacklist(idABloquear);
              alert(`¡Reserva ${idABloquear} agregada a la libreta negra!`);
              setIdABloquear('');
            }}
            style={{ padding: '8px 15px', backgroundColor: '#ff4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Bloquear Reserva
          </button>
        </div>
      </div>
      
    </div>
  );
}

export default App;