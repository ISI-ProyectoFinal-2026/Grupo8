import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

// Definimos el contrato de nuestro componente (Props)
interface ScannerQRProps {
  onScanSuccess: (token: string) => void;
}

export const ScannerQR = ({ onScanSuccess }: ScannerQRProps) => {
  const [permisoDenegado, setPermisoDenegado] = useState<boolean>(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    // Inicializamos el escáner de forma asíncrona
    const inicializarCamara = async () => {
      try {
        // 1. Solicitud de permisos de cámara nativa del dispositivo
        const devices = await Html5Qrcode.getCameras();
        
        if (devices && devices.length > 0) {
          // Instanciamos el escáner apuntando al div con id="lector-qr"
          scannerRef.current = new Html5Qrcode("lector-qr");
          
          await scannerRef.current.start(
            { facingMode: "environment" }, // Forzamos el uso de la cámara trasera
            {
              fps: 10, // Cuadros por segundo (balance óptimo entre batería y velocidad)
              qrbox: { width: 250, height: 250 }, // Guía visual para el usuario
              aspectRatio: 1.0,
            },
            (textoDecodificado) => {
              // 2. Éxito: Pausamos el escáner para dar feedback visual
              if (scannerRef.current) {
                scannerRef.current.pause();
              }
              // Enviamos el dato al componente padre
              onScanSuccess(textoDecodificado);
            },
            (_mensajeError) => {
              // Este callback se ejecuta silenciosamente cada frame que no ve un QR.
              // Lo dejamos vacío intencionalmente para no ensuciar la consola.
            }
          );
        }
      } catch (error) {
        console.error("Error solicitando permisos de cámara:", error);
        setPermisoDenegado(true);
      }
    };

    inicializarCamara();

    // 3. Cleanup: Apagar la cámara cuando el componente se desmonta (Evita fugas de memoria)
    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, [onScanSuccess]);

  return (
    <div style={{ width: '100%', maxWidth: '400px', margin: '0 auto' }}>
      {permisoDenegado ? (
        <div style={{ color: 'red', textAlign: 'center', padding: '20px' }}>
          <p>⚠️ No se pudo acceder a la cámara.</p>
          <p>Por favor, otorga los permisos en tu navegador y recarga la página.</p>
        </div>
      ) : (
        // Contenedor donde la librería inyectará el video
        <div id="lector-qr" style={{ borderRadius: '12px', overflow: 'hidden', border: '2px solid #ccc' }}></div>
      )}
    </div>
  );
};