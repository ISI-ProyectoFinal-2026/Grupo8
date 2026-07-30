import { useEffect, useState } from 'react';
import { dbService } from './services/dbService';
import { ScannerQR } from './components/ScannerQR';
import { verifyQRToken } from './utils/security';
import type { IJwtPayload } from './types/security';

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

  // Inicialización de la infraestructura offline al montar la aplicación
  useEffect(() => {
    const inicializarDB = async () => {
      try {
        // Aseguramos que la estructura de IndexedDB esté lista
        await dbService.guardarConfiguracion('version_app', '1.0.0');

        // Inicializamos los valores por defecto si no existen
        await dbService.guardarConfiguracion('capacidad_maxima', '500');
        
        // Cargamos los datos actuales para mostrarlos en la UI
        const ocupacionActual = await dbService.obtenerOcupacion();
        const max = await dbService.obtenerCapacidadMaxima();
        
        setOcupacion(ocupacionActual);
        setCapacidadMaxima(max);

      } catch (error) {
        console.error('❌ Error al inicializar IndexedDB:', error);
      }
    };
    inicializarDB();
  }, []);

  /**
   * Orquesta el flujo de validación cuando la cámara detecta un código QR.
   * Ejecuta validación criptográfica y persistencia de forma 100% offline.
   * 
   * @param token - El string JWT escaneado.
   */
  const procesarQR = async (token: string) => {
    // 1. Feedback UX: Vibración háptica al detectar el código
    navigator.vibrate?.(200); 
    setEscaneando(false); 
    
    // 2. Validación Criptográfica (Firma y Expiración temporal)
    const payload = await verifyQRToken(token);

    // Fail-Fast: Si la validación falla, detenemos el flujo y notificamos
    if (!payload) {
      setResultadoValidacion({
        exito: false,
        mensaje: '❌ Acceso Denegado: Código QR inválido, alterado o expirado.'
      });
      return; 
    }

    try {
      // 3. Validación de Negocio y Persistencia: 
      // Registramos el ingreso en IndexedDB. Si el 'jti' ya existe, arrojará error.
      await dbService.registrarIngresoOffline(payload.jti, payload);

      // ÉXITO (DoD Criterio 4 y 3)
      // Si la transacción pasó sin lanzar error, actualizamos la interfaz sumando las personas
      setOcupacion(prev => prev + payload.cantidad_personas);

      setResultadoValidacion({
        exito: true,
        mensaje: `✅ INGRESO CONFIRMADO (${payload.typ.toUpperCase()})`,
        payload: payload
      });


    } catch (error: any) {
      // Capturamos violaciones de reglas de negocio (ej. QR ya utilizado)
      setResultadoValidacion({
        exito: false,
        mensaje: `❌ Acceso Denegado: ${error.message}`
      });
    }
  };

  // Cálculo rápido para la UI
  const lugaresDisponibles = capacidadMaxima - ocupacion;
  const porcentajeOcupacion = (ocupacion / capacidadMaxima) * 100;

return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center' }}>Sistema de Acceso - Grupo 8</h1>
      
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
            
            disabled={lugaresDisponibles <= 0} // Deshabilitamos si el camping está lleno
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