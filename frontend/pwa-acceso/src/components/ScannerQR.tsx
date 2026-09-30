import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

// Definimos el contrato de nuestro componente (Props)
interface ScannerQRProps {
  onScanSuccess: (token: string) => void;
}

export const ScannerQR = ({ onScanSuccess }: ScannerQRProps) => {
  const [permisoDenegado, setPermisoDenegado] = useState<boolean>(false);
  // 👇 1. Nuevo estado para el input manual
  const [tokenManual, setTokenManual] = useState<string>(''); 
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    const inicializarCamara = async () => {
      try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          scannerRef.current = new Html5Qrcode("lector-qr");
          await scannerRef.current.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
              aspectRatio: 1.0,
            },
            (textoDecodificado) => {
              if (scannerRef.current) scannerRef.current.pause();
              onScanSuccess(textoDecodificado);
            },
            (_mensajeError) => {}
          );
        }
      } catch (error) {
        console.error("Error solicitando permisos de cámara:", error);
        setPermisoDenegado(true);
      }
    };

    inicializarCamara();

    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, [onScanSuccess]);

  // 👇 2. Función para manejar el envío del token manual
  const handleSimularEscaneo = (e: React.FormEvent) => {
    e.preventDefault(); // Evita que la página se recargue al enviar el form
    if (tokenManual.trim() !== '') {
      // Engañamos a la app llamando al éxito con el texto del input
      onScanSuccess(tokenManual.trim()); 
      setTokenManual(''); // Limpiamos el input para el siguiente test
    }
  };

  return (
    <div style={{ width: '100%', maxWidth: '400px', margin: '0 auto' }}>
      {/* Lector de cámara original */}
      {permisoDenegado ? (
        <div style={{ color: 'red', textAlign: 'center', padding: '20px' }}>
          <p>⚠️ No se pudo acceder a la cámara (Normal en PC sin cámara).</p>
        </div>
      ) : (
        <div id="lector-qr" style={{ borderRadius: '12px', overflow: 'hidden', border: '2px solid #ccc' }}></div>
      )}

      {/* 👇 3. Nueva barra de testeo manual (Modo Developer) */}
      <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', border: '2px dashed #007bff', borderRadius: '8px' }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#007bff', textAlign: 'center', fontFamily: 'sans-serif' }}>
          🔧 Modo Test (Simular QR)
        </h4>
        <form onSubmit={handleSimularEscaneo} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Pega el JWT aquí..."
            value={tokenManual}
            onChange={(e) => setTokenManual(e.target.value)}
            style={{ 
              flex: 1, 
              padding: '10px', 
              borderRadius: '6px', 
              border: '1px solid #ccc',
              outline: 'none'
            }}
          />
          <button 
            type="submit" 
            style={{ 
              padding: '10px 15px', 
              backgroundColor: '#007bff', 
              color: 'white', 
              border: 'none', 
              borderRadius: '6px', 
              cursor: 'pointer', 
              fontWeight: 'bold' 
            }}
          >
            Simular
          </button>
        </form>
      </div>
    </div>
  );
};