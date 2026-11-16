import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Ban, CheckCircle2, Loader2, ScanLine, XCircle } from 'lucide-react';
import { ScannerQR } from '../components/ScannerQR';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useCapacidad } from '../hooks/useCapacidad';
import { dbService } from '../services/dbService';
import { syncService } from '../services/syncService';
import type { IJwtPayload } from '../types/security';
import { verifyQRToken } from '../utils/security';

interface ResultadoValidacion {
  exito: boolean;
  mensaje: string;
  payload?: IJwtPayload | any;
}

interface ControlAccesoProps {
  /** "manual" abre directo el formulario de registro manual (ruta /acceso/manual). */
  modo?: 'escaner' | 'manual';
}

export default function ControlAcceso({ modo = 'escaner' }: ControlAccesoProps) {
  const navigate = useNavigate();
  const { capacidadMaxima, estado: estadoCapacidad } = useCapacidad();
  const [ocupacion, setOcupacion] = useState<number>(0);
  const [escaneando, setEscaneando] = useState<boolean>(false);
  const [resultadoValidacion, setResultadoValidacion] = useState<ResultadoValidacion | null>(null);

  const [mostrarFormulario, setMostrarFormulario] = useState<boolean>(false);
  const [formDni, setFormDni] = useState('');
  const [formNombre, setFormNombre] = useState('');
  const [formAcompanantes, setFormAcompanantes] = useState(0);
  const [formTipo, setFormTipo] = useState('Espontaneo');
  const [formMonto, setFormMonto] = useState('');
  const [syncStatus, setSyncStatus] = useState<{ estado: string; mensaje: string } | null>(null);

  // La barra inferior cambia entre el escáner (/acceso) y el registro manual (/acceso/manual)
  useEffect(() => {
    setEscaneando(false);
    setMostrarFormulario(modo === 'manual');
  }, [modo]);

  // El resultado de un registro manual viaja con la navegación de vuelta al escáner
  const location = useLocation();
  const resultadoRecibido = (location.state as { resultado?: ResultadoValidacion } | null)?.resultado;
  useEffect(() => {
    if (!resultadoRecibido) return;
    setResultadoValidacion(resultadoRecibido);
    // Se borra del historial: si no, al recargar la página volvería a aparecer el resultado viejo
    navigate(location.pathname, { replace: true, state: null });
  }, [resultadoRecibido, navigate, location.pathname]);

  // Al terminar o cancelar el registro manual se vuelve al escáner
  const cerrarFormulario = (resultado?: ResultadoValidacion) => {
    setMostrarFormulario(false);
    if (modo === 'manual') navigate('/acceso', { state: resultado ? { resultado } : null });
  };

  useEffect(() => {
    const inicializarDB = async () => {
      try {
        await dbService.guardarConfiguracion('version_app', '1.0.0');
        const ocupacionActual = await dbService.obtenerOcupacion();
        setOcupacion(ocupacionActual);
        await syncService.iniciarBackgroundSync();
      } catch (error) {
        console.error('Error al inicializar IndexedDB:', error);
      }
    };
    inicializarDB();
  }, []);

  useEffect(() => {
    const handleSyncEvent = (e: any) => {
      const { estado, detalles } = e.detail;
      if (estado === 'iniciando' || estado === 'reintentando') {
        setSyncStatus({ estado: 'warning', mensaje: `Sincronizando ${detalles.cantidad} registros pendientes...` });
      } else if (estado === 'completado') {
        setSyncStatus({ estado: 'success', mensaje: `¡Datos Actualizados! (${detalles.cantidad} enviados)` });
        setTimeout(() => setSyncStatus(null), 4000);
      } else if (estado === 'error') {
        setSyncStatus({ estado: 'error', mensaje: detalles.mensaje });
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
      setResultadoValidacion({ exito: false, mensaje: 'Acceso Denegado: Código QR inválido.' });
      return;
    }
    try {
      const estaRevocado = await dbService.verificarAccesoRevocado(payload.reserva_id.toString());
      if (estaRevocado) {
        setResultadoValidacion({ exito: false, mensaje: 'Reserva Cancelada / Acceso Revocado' });
        return;
      }
      await dbService.registrarIngresoOffline(payload.jti, payload);
      setOcupacion(prev => prev + payload.cantidad_personas);
      setResultadoValidacion({
        exito: true,
        mensaje: `INGRESO CONFIRMADO (${payload.typ.toUpperCase()})`,
        payload: payload
      });
    } catch (error: any) {
      setResultadoValidacion({ exito: false, mensaje: `Acceso Denegado: ${error.message}` });
    }
  };

  const handleIngresoManual = async (e: FormEvent) => {
    e.preventDefault();
    if (!formDni.trim() || !formNombre.trim()) {
      alert("Por favor, complete el DNI y Nombre del visitante.");
      return;
    }

    const monto = Number(formMonto);
    if (formMonto.trim() === '' || !Number.isFinite(monto) || monto < 0) {
      alert("Ingrese el monto cobrado (0 si no se cobró nada).");
      return;
    }

    try {
      await dbService.registrarIngresoManual(formDni, formNombre, formAcompanantes, formTipo, monto);
      const totalIngresan = formAcompanantes + 1;
      setOcupacion(prev => prev + totalIngresan);
      const resultado: ResultadoValidacion = {
        exito: true,
        mensaje: `INGRESO MANUAL REGISTRADO (${formTipo.toUpperCase()})`,
        payload: { dni: formDni, nombre: formNombre, cantidad_personas: totalIngresan, monto_cobrado: monto }
      };
      setResultadoValidacion(resultado);
      setFormDni('');
      setFormNombre('');
      setFormAcompanantes(0);
      setFormTipo('Espontaneo');
      setFormMonto('');
      cerrarFormulario(resultado);
    } catch (error: any) {
      setResultadoValidacion({ exito: false, mensaje: `Error de ingreso: ${error.message}` });
    }
  };

  // Con la capacidad desconocida no hay cupo que calcular ni nada que bloquear
  const lugaresDisponibles = capacidadMaxima === null ? null : capacidadMaxima - ocupacion;
  const campingLleno = lugaresDisponibles !== null && lugaresDisponibles <= 0;
  const porcentajeOcupacion = capacidadMaxima === null ? null : (ocupacion / capacidadMaxima) * 100;

  // Estilo del aviso de sincronización y del resultado: color, ícono y texto, no solo color
  const AVISO_SYNC: Record<string, { clase: string; Icono: typeof CheckCircle2 }> = {
    warning: { clase: 'border-amber-300 bg-amber-50 text-amber-900', Icono: Loader2 },
    success: { clase: 'border-bosque-200 bg-bosque-50 text-bosque-800', Icono: CheckCircle2 },
    error: { clase: 'border-red-200 bg-red-50 text-red-800', Icono: AlertTriangle },
  };
  const avisoSync = syncStatus ? AVISO_SYNC[syncStatus.estado] ?? AVISO_SYNC.error : null;

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <h1 className="text-center text-2xl font-semibold text-foreground">Control de acceso</h1>

      {syncStatus && avisoSync && (
        <div
          role="status"
          className={cn('flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-center font-semibold', avisoSync.clase)}
        >
          <avisoSync.Icono
            className={cn('h-5 w-5 shrink-0', syncStatus.estado === 'warning' && 'animate-spin')}
            aria-hidden="true"
          />
          {syncStatus.mensaje}
        </div>
      )}

      {lugaresDisponibles !== null && capacidadMaxima !== null && porcentajeOcupacion !== null ? (
        <div className="flex items-center justify-between rounded-3xl border border-tierra-200/70 bg-white px-5 py-4 shadow-sm">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Capacidad Disponible</p>
            <h2 className={cn('mt-1 text-3xl font-bold', lugaresDisponibles < 20 ? 'text-destructive' : 'text-primary')}>
              {lugaresDisponibles} <span className="text-base font-medium text-muted-foreground">/ {capacidadMaxima}</span>
            </h2>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-muted-foreground">Ocupación</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{porcentajeOcupacion.toFixed(1)}%</p>
          </div>
        </div>
      ) : (
        <div role="status" className="rounded-3xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900">
          <strong>
            {estadoCapacidad === 'cargando' ? 'Consultando la capacidad del camping…' : 'Capacidad no disponible'}
          </strong>
          {estadoCapacidad === 'sin_dato' && (
            <p className="mt-2">
              Este dispositivo todavía no descargó la capacidad máxima. Podés seguir registrando ingresos,
              pero sin control de cupo. Conectate a internet una vez para descargarla.
            </p>
          )}
          <p className="mt-2 text-sm">Ocupación registrada: {ocupacion} personas</p>
        </div>
      )}

      {!escaneando && !mostrarFormulario ? (
        <div className="flex flex-col gap-3">
          <Button
            onClick={() => { setResultadoValidacion(null); setEscaneando(true); }}
            disabled={campingLleno}
            className="h-16 w-full text-lg font-semibold"
          >
            {campingLleno ? <Ban className="!size-6" aria-hidden="true" /> : <ScanLine className="!size-6" aria-hidden="true" />}
            {campingLleno ? 'CAMPING LLENO' : 'Escanear QR'}
          </Button>
        </div>
      ) : escaneando ? (
        <div className="space-y-4 text-center">
          <h2 className="text-lg font-semibold text-foreground">Apunte al código del visitante</h2>
          <ScannerQR onScanSuccess={procesarQR} />
          <Button variant="outline" onClick={() => setEscaneando(false)} className="h-12 w-full text-base">
            Cancelar
          </Button>
        </div>
      ) : (
        <form onSubmit={handleIngresoManual} className="space-y-4 rounded-3xl border border-tierra-200/70 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Registro Manual de Ingreso</h2>
          {campingLleno && (
            <p role="alert" className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-semibold text-red-800">
              <Ban className="h-5 w-5 shrink-0" aria-hidden="true" />
              CAMPING LLENO: no se pueden registrar más ingresos.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="manual-dni" className="text-base">DNI / Pasaporte</Label>
            <Input id="manual-dni" type="text" value={formDni} onChange={e => setFormDni(e.target.value)} className="h-12 text-base" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-nombre" className="text-base">Nombre completo</Label>
            <Input id="manual-nombre" type="text" value={formNombre} onChange={e => setFormNombre(e.target.value)} className="h-12 text-base" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="manual-acompanantes" className="text-base">Acompañantes</Label>
              <Input id="manual-acompanantes" type="number" min="0" value={formAcompanantes} onChange={e => setFormAcompanantes(parseInt(e.target.value) || 0)} className="h-12 text-base" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-tipo" className="text-base">Tipo de Ingreso</Label>
              <select
                id="manual-tipo"
                value={formTipo}
                onChange={e => setFormTipo(e.target.value)}
                className="flex h-12 w-full rounded-xl border border-input bg-white px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="Espontaneo">Espontáneo (Sin reserva)</option>
                <option value="Manual con Reserva">Manual con Reserva</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-monto" className="text-base">Monto cobrado en efectivo ($)</Label>
            <Input
              id="manual-monto"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={formMonto}
              onChange={e => setFormMonto(e.target.value)}
              placeholder="0.00"
              className="h-12 text-base"
              required
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={campingLleno} className="h-14 flex-1 text-base font-semibold">Guardar Ingreso</Button>
            <Button type="button" variant="secondary" onClick={() => cerrarFormulario()} className="h-14 px-6 text-base">
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {resultadoValidacion && (
        <div
          role="alert"
          className={cn(
            'rounded-3xl border-2 bg-white p-5 text-center shadow-sm',
            resultadoValidacion.exito ? 'border-bosque-600 text-bosque-800' : 'border-destructive text-red-800'
          )}
        >
          {resultadoValidacion.exito ? (
            <CheckCircle2 className="mx-auto mb-2 h-12 w-12 text-primary" aria-hidden="true" />
          ) : (
            <XCircle className="mx-auto mb-2 h-12 w-12 text-destructive" aria-hidden="true" />
          )}
          <h2 className="text-xl font-bold">{resultadoValidacion.mensaje}</h2>
          {resultadoValidacion.exito && resultadoValidacion.payload && (
            <div className="mt-4 inline-block space-y-1 rounded-2xl bg-tierra-50 px-4 py-3 text-left text-base text-foreground">
              {resultadoValidacion.payload.dni && <p><strong>DNI/ID:</strong> {resultadoValidacion.payload.dni}</p>}
              {resultadoValidacion.payload.nombre && <p><strong>Nombre:</strong> {resultadoValidacion.payload.nombre}</p>}
              <p><strong>Personas Ingresadas:</strong> {resultadoValidacion.payload.cantidad_personas}</p>
              {resultadoValidacion.payload.monto_cobrado !== undefined && (
                <p><strong>Monto cobrado:</strong> ${Number(resultadoValidacion.payload.monto_cobrado).toFixed(2)}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
