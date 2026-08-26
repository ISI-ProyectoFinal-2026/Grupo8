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
  // INGRESO MANUAL
  // ==========================================
  const [mostrarFormulario, setMostrarFormulario] = useState<boolean>(false);
  const [formDni, setFormDni] = useState('');
  const [formNombre, setFormNombre] = useState('');
  const [formAcompanantes, setFormAcompanantes] = useState(0);
  const [formTipo, setFormTipo] = useState('Espontaneo');

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

  const procesarQR = async (token: string) => {
    navigator.vibrate?.(200); 
    setEscaneando(false); 
    const payload = await verifyQRToken(token);

    if (!payload) {
      setResultadoValidacion({ exito: false, mensaje: '❌ Acceso Denegado: Código QR inválido.' });
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
      setResultadoValidacion({ exito: false, mensaje: `❌ Acceso Denegado: ${error.message}` });
    }
  };

  // ==========================================
  // PROCESAR FORMULARIO
  // ==========================================
  const handleIngresoManual = async (e: FormEvent) => {
    e.preventDefault(); // Evita que la página se recargue al mandar el form
    
    // 1. Validación de datos obligatorios (DoD)
    if (!formDni.trim() || !formNombre.trim()) {
      alert("⚠️ Por favor, complete el DNI y Nombre del visitante.");
      return;
    }

    try {
      // 2. Guardamos en la base de datos (IndexDB)
      await dbService.registrarIngresoManual(formDni, formNombre, formAcompanantes, formTipo);
      
      // 3. Si pasa el control de capacidad local, actualizamos la UI
      const totalIngresan = formAcompanantes + 1; // Titular + Acompañantes
      setOcupacion(prev => prev + totalIngresan);
      
      setResultadoValidacion({
        exito: true,
        mensaje: `✅ INGRESO MANUAL REGISTRADO (${formTipo.toUpperCase()})`,
        payload: { dni: formDni, nombre: formNombre, cantidad_personas: totalIngresan }
      });

      // 4. Limpiamos el formulario y lo cerramos
      setFormDni('');
      setFormNombre('');
      setFormAcompanantes(0);
      setFormTipo('Espontaneo');
      setMostrarFormulario(false);

    } catch (error: any) {
      // Capturamos si la capacidad máxima es excedida
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
        {/* Renderizado condicional: Mostramos los botones si no estamos escaneando ni llenando el form */}
        {!escaneando && !mostrarFormulario ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <button 
              onClick={() => { setResultadoValidacion(null); setEscaneando(true); }}
              disabled={lugaresDisponibles <= 0} 
              style={{ padding: '15px', fontSize: '18px', backgroundColor: lugaresDisponibles <= 0 ? '#6c757d' : '#0056b3', color: 'white', border: 'none', borderRadius: '8px', cursor: lugaresDisponibles <= 0 ? 'not-allowed' : 'pointer' }}
            >
              {lugaresDisponibles <= 0 ? '🛑 CAMPING LLENO' : '📸 Escanear QR'}
            </button>
            
            {/* NUEVO BOTÓN 7.3 */}
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
          /* ========================================== */
          /* FORMULARIO ISSUE 7.3 */
          /* ========================================== */
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
    </div>
  );
}

export default App;