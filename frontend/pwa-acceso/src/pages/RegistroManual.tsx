import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Ban, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConexion } from '@/hooks/useConexion';
import { validarAccesoQR } from '@/services/accessValidationService';
import { MENSAJE_QR_FUERA_DE_FECHA } from '@/utils/vigenciaQR';
import { dbService } from '@/services/dbService';

/** Lo que muestra la confirmación (pantalla 4 del documento). */
interface IngresoRegistrado {
  idLocal: string;
  personas: number;
  monto: number;
}

const TIPO_ESPONTANEO = 'Espontaneo';
const TIPO_CON_RESERVA = 'Manual con Reserva';

const FORMULARIO_VACIO = {
  dni: '',
  nombre: '',
  acompanantes: 0,
  tipo: TIPO_ESPONTANEO,
  codigo: '', // texto del QR de la reserva; solo se pide en "Manual con Reserva"
  monto: '',
};

/**
 * Registro manual de la app del guardia (/acceso/manual), con cobro en efectivo.
 * Con "Manual con Reserva" se pide el código del QR: se verifica con la clave pública del
 * dispositivo (sirve sin conexión) y el ingreso queda vinculado a esa reserva (29.1).
 * Tiene dos vistas en el mismo componente: el formulario y, al guardar, la confirmación
 * con el ID local. No es otra ruta a propósito: si se recarga o se vuelve atrás, aparece
 * el formulario vacío y no una confirmación de un ingreso que ya quedó guardado.
 */
export default function RegistroManual() {
  const navigate = useNavigate();
  const { enLinea } = useConexion();
  const [form, setForm] = useState(FORMULARIO_VACIO);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [registrado, setRegistrado] = useState<IngresoRegistrado | null>(null);
  const tituloConfirmacion = useRef<HTMLHeadingElement>(null);

  // Cupo con lo guardado en el dispositivo: sirve igual sin conexión. dbService lo vuelve a controlar al guardar
  const cupo = useLiveQuery(async () => {
    const [capacidad, ocupacion] = await Promise.all([
      dbService.obtenerCapacidadMaxima(),
      dbService.obtenerOcupacion(),
    ]);
    return { capacidad, ocupacion };
  }, []);
  const campingLleno =
    cupo?.capacidad != null && cupo.ocupacion >= cupo.capacidad;
  const conReserva = form.tipo === TIPO_CON_RESERVA;

  // Al cambiar de vista, el foco va al título de la confirmación: el lector la anuncia
  // y el foco no queda perdido en el botón "Guardar ingreso", que ya no existe
  useEffect(() => {
    if (registrado) tituloConfirmacion.current?.focus();
  }, [registrado]);

  const cambiar = <K extends keyof typeof FORMULARIO_VACIO>(
    campo: K,
    valor: (typeof FORMULARIO_VACIO)[K]
  ) => setForm((actual) => ({ ...actual, [campo]: valor }));

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    setError(null);

    if (!form.dni.trim() || !form.nombre.trim()) {
      setError('Completá el DNI y el nombre del visitante.');
      return;
    }
    const monto = Number(form.monto);
    if (form.monto.trim() === '' || !Number.isFinite(monto) || monto < 0) {
      setError('Ingresá el monto cobrado (0 si no se cobró nada).');
      return;
    }

    if (conReserva && !form.codigo.trim()) {
      setError('Ingresá el código de la reserva (el texto del QR).');
      return;
    }

    setGuardando(true);
    try {
      let idLocal: string;
      let personas = form.acompanantes + 1;

      if (conReserva) {
        // El código se verifica contra la firma y la lista de cancelaciones guardadas en el dispositivo
        const validacion = await validarAccesoQR(form.codigo.trim());
        if (validacion.status === 'INVALID_TOKEN') {
          setError(
            'Código inválido: no corresponde a ninguna reserva, fue modificado o está vencido.'
          );
          return;
        }
        if (validacion.status === 'FUERA_DE_FECHA') {
          setError(MENSAJE_QR_FUERA_DE_FECHA);
          return;
        }
        if (validacion.status === 'REVOKED') {
          setError('Reserva cancelada: no se puede registrar el ingreso.');
          return;
        }
        idLocal = await dbService.registrarIngresoManualConReserva(
          form.dni.trim(),
          form.nombre.trim(),
          validacion.payload,
          monto
        );
        // La cantidad de personas la define la reserva
        personas = validacion.payload.cantidad_personas;
      } else {
        idLocal = await dbService.registrarIngresoManual(
          form.dni.trim(),
          form.nombre.trim(),
          form.acompanantes,
          form.tipo,
          monto
        );
      }

      setRegistrado({ idLocal, personas, monto });
      setForm(FORMULARIO_VACIO);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      // El mismo QR (jti) o la misma reserva ya registrados en este dispositivo
      if (
        mensaje.startsWith('QR_DUPLICADO') ||
        mensaje.startsWith('RESERVA_YA_INGRESADA')
      ) {
        setError('Esta reserva ya ingresó: el código ya fue registrado.');
      } else {
        setError(`No se pudo registrar el ingreso: ${mensaje}`);
      }
    } finally {
      setGuardando(false);
    }
  };

  if (registrado) {
    return (
      <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
        <section
          aria-labelledby="titulo-ingreso-registrado"
          className="space-y-4 rounded-3xl border-2 border-bosque-600 bg-white p-6 text-center shadow-sm"
        >
          <CheckCircle2
            className="mx-auto h-14 w-14 text-primary"
            aria-hidden="true"
          />
          <h1
            id="titulo-ingreso-registrado"
            ref={tituloConfirmacion}
            tabIndex={-1}
            className="text-2xl font-bold text-bosque-800 focus:outline-none"
          >
            Ingreso registrado
          </h1>
          <dl className="mx-auto max-w-sm space-y-2 rounded-2xl bg-tierra-50 px-4 py-3 text-left text-base">
            <div>
              <dt className="text-sm text-muted-foreground">ID local</dt>
              <dd className="break-all font-mono text-sm font-semibold text-foreground">
                {registrado.idLocal}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Personas</dt>
              <dd className="font-semibold text-foreground">
                {registrado.personas}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Monto cobrado</dt>
              <dd className="font-semibold text-foreground">
                ${registrado.monto.toFixed(2)}
              </dd>
            </div>
          </dl>
          <p className="text-base text-muted-foreground">
            {enLinea
              ? 'Se envía al servidor en la próxima sincronización.'
              : 'Se sincronizará cuando regrese Internet.'}
          </p>
          <Button
            onClick={() => navigate('/acceso')}
            className="h-14 w-full text-base font-semibold"
          >
            Aceptar
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <h1 className="text-center text-2xl font-semibold text-foreground">
        Registro manual
      </h1>

      <form
        onSubmit={guardar}
        noValidate
        aria-describedby={error ? 'error-registro-manual' : undefined}
        className="space-y-4 rounded-3xl border border-tierra-200/70 bg-white p-5 shadow-sm"
      >
        {campingLleno && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-semibold text-red-800"
          >
            <Ban className="h-5 w-5 shrink-0" aria-hidden="true" />
            CAMPING LLENO: no se pueden registrar más ingresos.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="manual-dni" className="text-base">
            DNI / Pasaporte
          </Label>
          <Input
            id="manual-dni"
            type="text"
            value={form.dni}
            onChange={(e) => cambiar('dni', e.target.value)}
            className="h-12 text-base"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="manual-nombre" className="text-base">
            Nombre completo
          </Label>
          <Input
            id="manual-nombre"
            type="text"
            value={form.nombre}
            onChange={(e) => cambiar('nombre', e.target.value)}
            className="h-12 text-base"
            required
          />
        </div>
        <div className={conReserva ? 'grid gap-3' : 'grid grid-cols-2 gap-3'}>
          {/* Con reserva, la cantidad de personas viene en el QR */}
          {!conReserva && (
            <div className="space-y-2">
              <Label htmlFor="manual-acompanantes" className="text-base">
                Acompañantes
              </Label>
              <Input
                id="manual-acompanantes"
                type="number"
                min="0"
                value={form.acompanantes}
                onChange={(e) =>
                  cambiar(
                    'acompanantes',
                    Math.max(0, parseInt(e.target.value, 10) || 0)
                  )
                }
                className="h-12 text-base"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="manual-tipo" className="text-base">
              Tipo de Ingreso
            </Label>
            <select
              id="manual-tipo"
              value={form.tipo}
              onChange={(e) => cambiar('tipo', e.target.value)}
              className="flex h-12 w-full rounded-xl border border-input bg-white px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value={TIPO_ESPONTANEO}>Espontáneo (Sin reserva)</option>
              <option value={TIPO_CON_RESERVA}>Manual con Reserva</option>
            </select>
          </div>
        </div>
        {conReserva && (
          <div className="space-y-2">
            <Label htmlFor="manual-codigo" className="text-base">
              Código de la reserva (QR)
            </Label>
            <Input
              id="manual-codigo"
              type="text"
              value={form.codigo}
              onChange={(e) => cambiar('codigo', e.target.value)}
              aria-describedby="ayuda-codigo-reserva"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-12 text-base"
              required
            />
            <p
              id="ayuda-codigo-reserva"
              className="text-sm text-muted-foreground"
            >
              Pegá o escribí el texto del QR que tiene el visitante. Se verifica
              en este dispositivo, aun sin Internet.
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="manual-monto" className="text-base">
            Monto cobrado en efectivo ($)
          </Label>
          <Input
            id="manual-monto"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={form.monto}
            onChange={(e) => cambiar('monto', e.target.value)}
            placeholder="0.00"
            className="h-12 text-base"
            required
          />
        </div>

        {error && (
          <p
            id="error-registro-manual"
            role="alert"
            className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-800"
          >
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden="true"
            />
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button
            type="submit"
            disabled={campingLleno || guardando}
            className="h-14 flex-1 text-base font-semibold"
          >
            {guardando ? 'Guardando…' : 'Guardar Ingreso'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/acceso')}
            className="h-14 px-6 text-base"
          >
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
