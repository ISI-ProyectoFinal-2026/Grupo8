import { useEffect, useState } from 'react';
import { dbService } from './services/dbService';
import { ScannerQR } from './components/ScannerQR';

function App() {
  const [escaneando, setEscaneando] = useState<boolean>(false);
  const [ultimoQR, setUltimoQR] = useState<string | null>(null);

  useEffect(() => {
    const inicializarDB = async () => {
      try {
        await dbService.guardarConfiguracion('version_app', '1.0.0');
      } catch (error) {
        console.error('❌ Error al inicializar IndexedDB:', error);
      }
    };
    inicializarDB();
  }, []);

  // Función que se ejecuta cuando la cámara lee un QR
  const procesarQR = (token: string) => {
    // Emitimos un sonido corto si el navegador lo permite (Opcional UX)
    navigator.vibrate?.(200); 
    
    setUltimoQR(token);
    setEscaneando(false); // Desmonta el escáner y apaga la cámara
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center' }}>Sistema de Acceso - Grupo 8</h1>
      
      {/* Panel de Control Central */}
      <div style={{ textAlign: 'center', marginTop: '30px' }}>
        {!escaneando ? (
          <button 
            onClick={() => {
              setUltimoQR(null);
              setEscaneando(true);
            }}
            style={{
              padding: '15px 30px',
              fontSize: '18px',
              backgroundColor: '#0056b3',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}
          >
            📸 Escanear QR
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

      {/* Retroalimentación Visual de Éxito */}
      {ultimoQR && (
        <div style={{ 
          marginTop: '30px', 
          padding: '20px', 
          backgroundColor: '#d4edda', 
          border: '2px solid #28a745',
          borderRadius: '8px',
          color: '#155724',
          textAlign: 'center'
        }}>
          <h2>✅ QR Detectado</h2>
          <p style={{ wordBreak: 'break-all', fontSize: '14px' }}><strong>Token:</strong> {ultimoQR}</p>
          <p style={{ fontSize: '12px', marginTop: '10px' }}>
            <em>(En la próxima sub-issue, este token será desencriptado y validado matemáticamente aquí)</em>
          </p>
        </div>
      )}
    </div>
  );
}

export default App;