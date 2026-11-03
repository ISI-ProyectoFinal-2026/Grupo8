import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface ScannerQRProps {
  onScanSuccess: (token: string) => void;
}

export const ScannerQR = ({ onScanSuccess }: ScannerQRProps) => {
  const [permisoDenegado, setPermisoDenegado] = useState<boolean>(false);
  const [tokenManual, setTokenManual] = useState<string>('');

  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Bandera para frenar el doble montaje de StrictMode
  const inicializado = useRef<boolean>(false);

  useEffect(() => {
    if (inicializado.current) return;
    inicializado.current = true;

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
      // Al desmontar se detiene la cámara y se borra el HTML residual
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          scannerRef.current.stop().catch(console.error).finally(() => {
            scannerRef.current?.clear();
          });
        } else {
          scannerRef.current.clear();
        }
      }
    };
  }, [onScanSuccess]);

  // Ingreso manual del token, por si la cámara no funciona. Pasa por la misma validación que el QR escaneado.
  const handleTokenManual = (e: FormEvent) => {
    e.preventDefault();
    if (tokenManual.trim() !== '') {
      onScanSuccess(tokenManual.trim());
      setTokenManual('');
    }
  };

  return (
    <div style={{ width: '100%', maxWidth: '400px', margin: '0 auto' }}>
      {permisoDenegado ? (
        <div style={{ color: 'red', textAlign: 'center', padding: '20px' }}>
          <p>⚠️ No se pudo acceder a la cámara (Normal en PC sin cámara).</p>
        </div>
      ) : (
        <div id="lector-qr" style={{ borderRadius: '12px', overflow: 'hidden', border: '2px solid #ccc' }}></div>
      )}

      <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', border: '1px solid #ccc', borderRadius: '8px' }}>
        <h4 style={{ margin: '0 0 10px 0', textAlign: 'center', fontFamily: 'sans-serif' }}>
          Ingresar token manualmente
        </h4>
        <form onSubmit={handleTokenManual} style={{ display: 'flex', gap: '8px' }}>
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
              backgroundColor: '#0056b3',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Validar
          </button>
        </form>
      </div>
    </div>
  );
};