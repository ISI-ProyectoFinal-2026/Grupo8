import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { CameraOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <div className="mx-auto w-full max-w-md space-y-4">
      {permisoDenegado ? (
        <div role="alert" className="flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left text-amber-900">
          <CameraOff className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>No se pudo acceder a la cámara (Normal en PC sin cámara).</p>
        </div>
      ) : (
        <div id="lector-qr" className="overflow-hidden rounded-3xl border-2 border-tierra-300 bg-tierra-900"></div>
      )}

      <div className="rounded-3xl border border-tierra-200/70 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-center text-base font-semibold text-foreground">
          Ingresar token manualmente
        </h3>
        <form onSubmit={handleTokenManual} className="flex gap-2">
          <Input
            type="text"
            aria-label="Token del QR"
            placeholder="Pegá el código del QR"
            value={tokenManual}
            onChange={(e) => setTokenManual(e.target.value)}
            className="h-12 flex-1 text-base"
          />
          <Button type="submit" className="h-12 px-5 text-base font-semibold">
            Validar
          </Button>
        </form>
      </div>
    </div>
  );
};
