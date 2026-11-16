import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import DialogoCancelacion from "@/components/DialogoCancelacion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { formatearMonto } from "@/lib/cotizacion";
import { formatearFecha } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import {
  agruparReservas,
  descargarQr,
  guardarArchivo,
  obtenerMisReservas,
  type CategoriaReserva,
  type ReservaDetalle,
  type ResultadoCancelacion,
} from "@/lib/misReservas";
import {
  CalendarCheck,
  CalendarX2,
  CircleCheck,
  CircleX,
  Clock,
  QrCode,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";

// URL base del backend (se puede sobreescribir con VITE_API_URL en el .env del frontend)
const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

// El estado no se distingue solo por el color: cada etiqueta lleva texto y un ícono propio
const ICONO_POR_CATEGORIA: Record<CategoriaReserva, LucideIcon> = {
  pendiente: Clock,
  proxima: CalendarCheck,
  finalizada: CircleCheck,
  cancelada: CircleX,
};

// Resultado de "Verificar pago": se muestra en la pantalla en lugar de una ventana del navegador
interface AvisoPago {
  tipo: "ok" | "info" | "error";
  texto: string;
}

const PESTANAS: { valor: CategoriaReserva; titulo: string }[] = [
  { valor: "pendiente", titulo: "Pendientes" },
  { valor: "proxima", titulo: "Próximas" },
  { valor: "finalizada", titulo: "Finalizadas" },
  { valor: "cancelada", titulo: "Canceladas" },
];

export default function MisReservas() {
  const { token } = useAuth();

  const [reservas, setReservas] = useState<ReservaDetalle[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado para saber qué botón está cargando y evitar doble clic
  const [reconciliandoId, setReconciliandoId] = useState<string | null>(null);

  const [descargandoId, setDescargandoId] = useState<string | null>(null);
  const [errorQr, setErrorQr] = useState<string | null>(null);

  // Reserva cuyo diálogo de cancelación está abierto, y el resultado de la última cancelación
  const [reservaACancelar, setReservaACancelar] = useState<ReservaDetalle | null>(null);
  const [avisoCancelacion, setAvisoCancelacion] = useState<string | null>(null);
  const [avisoPago, setAvisoPago] = useState<AvisoPago | null>(null);

  // Botón "Cancelar" que abrió el diálogo, para devolverle el foco al cerrarlo
  const botonQueAbrio = useRef<HTMLElement | null>(null);
  const refAvisoCancelacion = useRef<HTMLParagraphElement>(null);

  const cargarReservas = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setCargando(true);
      setError(null);
      try {
        const lista = await obtenerMisReservas(token, signal);
        setReservas(lista);
      } catch (e) {
        if (signal?.aborted) return;
        setError(e instanceof Error ? e.message : "No pudimos cargar tus reservas. Intentá nuevamente.");
      } finally {
        if (!signal?.aborted) setCargando(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (!token) {
      setReservas([]);
      return;
    }
    const controlador = new AbortController();
    cargarReservas(controlador.signal);
    return () => controlador.abort();
  }, [token, cargarReservas]);

  const verificarPago = async (reservaId: string) => {
    try {
      setReconciliandoId(reservaId);
      setAvisoPago(null);

      const response = await fetch(
        `${API_URL}/api/payments/reconcile/${reservaId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await response.json();

      if (response.ok) {
        if (data.status === "reconciliado") {
          setAvisoPago({ tipo: "ok", texto: data.message });
          // La reserva pasó a pagada: recargamos la lista para que cambie de pestaña
          await cargarReservas();
        } else {
          setAvisoPago({ tipo: "info", texto: data.message });
        }
      } else {
        setAvisoPago({ tipo: "error", texto: data.detail || "No pudimos verificar el pago. Intentá nuevamente." });
      }
    } catch (error) {
      console.error("Error consultando API:", error);
      setAvisoPago({ tipo: "error", texto: "No pudimos comunicarnos con el servidor. Revisá tu conexión." });
    } finally {
      setReconciliandoId(null);
    }
  };

  const bajarQr = async (reservaId: string) => {
    if (!token) return;
    setDescargandoId(reservaId);
    setErrorQr(null);
    try {
      const qr = await descargarQr(token, reservaId);
      guardarArchivo(qr, `QR_Acceso_${reservaId}.png`);
    } catch (e) {
      setErrorQr(e instanceof Error ? e.message : "No pudimos descargar el QR. Intentá nuevamente.");
    } finally {
      setDescargandoId(null);
    }
  };

  const abrirCancelacion = (reserva: ReservaDetalle, boton: HTMLElement) => {
    botonQueAbrio.current = boton;
    setAvisoCancelacion(null);
    setReservaACancelar(reserva);
  };

  // La reserva pasa a Canceladas con la respuesta del backend, sin volver a pedir la lista
  const alCancelar = (resultado: ResultadoCancelacion) => {
    setReservas((anteriores) =>
      anteriores.map((r) =>
        r.id === resultado.id
          ? { ...r, estado_reserva: resultado.estado_reserva, estado_pago: resultado.estado_pago }
          : r
      )
    );
    setAvisoCancelacion(resultado.mensaje);
    setReservaACancelar(null);
  };

  // Al cerrar el diálogo el foco vuelve al botón "Cancelar". Si la reserva se canceló, la tarjeta
  // pasó a Canceladas y el botón ya no está: el foco va al mensaje con el resultado
  const devolverFoco = (evento: Event) => {
    evento.preventDefault();
    const boton = botonQueAbrio.current;
    (boton?.isConnected ? boton : refAvisoCancelacion.current)?.focus();
    botonQueAbrio.current = null;
  };

  // Sin sesión no hay reservas propias para mostrar
  if (!token) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-tierra-900 mb-6">Mis Reservas</h1>
        <div className="text-center py-12 text-tierra-600 space-y-4">
          <CalendarX2 className="w-12 h-12 mx-auto opacity-20" />
          <p>Iniciá sesión para ver tus reservas.</p>
          <Button asChild>
            <Link to="/login">Iniciar sesión</Link>
          </Button>
        </div>
      </div>
    );
  }

  const grupos = agruparReservas(reservas);

  const renderizarTarjetas = (categoria: CategoriaReserva) => {
    const filtradas = grupos[categoria];

    if (filtradas.length === 0) {
      return (
        <div className="text-center py-12 text-tierra-500">
          <CalendarX2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
          No hay reservas en esta categoría.
        </div>
      );
    }

    const IconoEstado = ICONO_POR_CATEGORIA[categoria];

    return filtradas.map((reserva) => (
      <Card
        key={reserva.id}
        // Un lector de pantalla anuncia cada tarjeta por su reserva, como "Reserva 1a2b3c4d"
        role="article"
        aria-label={`Reserva ${reserva.id.slice(0, 8)}`}
        className="mb-4"
      >
        <CardHeader className="pb-3 flex flex-row items-center justify-between bg-tierra-50 rounded-t-xl border-b">
          <div>
            <CardTitle className="text-lg">Reserva {reserva.id.slice(0, 8)}...</CardTitle>
            <p className="text-sm text-tierra-500">
              {formatearFecha(reserva.fecha_ingreso)}
              {reserva.fecha_egreso !== reserva.fecha_ingreso ? ` al ${formatearFecha(reserva.fecha_egreso)}` : ""}
              {" · "}
              {reserva.cantidad_personas} {reserva.cantidad_personas === 1 ? "persona" : "personas"}
              {reserva.cantidad_socios > 0
                ? ` (${reserva.cantidad_socios} ${reserva.cantidad_socios === 1 ? "socio" : "socios"})`
                : ""}
            </p>
          </div>
          <Badge variant={categoria === 'cancelada' ? 'destructive' : 'default'}
                 className={cn(
                   'gap-1',
                   categoria === 'proxima' && 'bg-bosque-600',
                   categoria === 'pendiente' && 'bg-amber-100 text-amber-900 hover:bg-amber-100'
                 )}>
            <IconoEstado className="h-3.5 w-3.5" />
            {reserva.estado_reserva.toUpperCase()}
          </Badge>
        </CardHeader>
        <CardContent className="pt-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-xl font-bold text-tierra-900">{formatearMonto(reserva.monto_total)}</div>
          <div className="flex gap-2 w-full md:w-auto">

            {/* Lógica para reservas PAGADAS / PRÓXIMAS */}
            {/* "Cancelar" se muestra siempre: si está fuera de plazo, el diálogo explica por qué */}
            {categoria === 'proxima' && (
              <Button
                variant="outline"
                onClick={(e) => abrirCancelacion(reserva, e.currentTarget)}
                className="flex-1 md:flex-none"
              >
                Cancelar
              </Button>
            )}
            {categoria === 'proxima' && (
              <Button
                onClick={() => bajarQr(reserva.id)}
                disabled={descargandoId === reserva.id}
                className="flex-1 md:flex-none flex gap-2 bg-tierra-900"
              >
                <QrCode className="w-4 h-4" />
                {descargandoId === reserva.id ? "Descargando..." : "Descargar QR"}
              </Button>
            )}

            {/* Lógica para reservas PENDIENTES */}
            {categoria === 'pendiente' && (
              <Button
                onClick={() => verificarPago(reserva.id)}
                disabled={reconciliandoId === reserva.id}
                className="flex-1 md:flex-none flex gap-2 bg-amber-700 hover:bg-amber-800 text-white"
              >
                <RefreshCw className={`w-4 h-4 ${reconciliandoId === reserva.id ? 'animate-spin' : ''}`} />
                {reconciliandoId === reserva.id ? 'Verificando...' : 'Verificar Pago'}
              </Button>
            )}

            {categoria === 'finalizada' && (
              <Button variant="outline" className="w-full md:w-auto">Ver detalle</Button>
            )}
          </div>
        </CardContent>
      </Card>
    ));
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold text-tierra-900 mb-6">Mis Reservas</h1>

      {cargando && reservas.length === 0 && (
        <p role="status" className="text-center py-12 text-tierra-500">Cargando tus reservas…</p>
      )}

      {error && (
        <div role="alert" className="text-center py-8 text-destructive space-y-3">
          <p>{error}</p>
          <Button variant="outline" onClick={() => cargarReservas()}>Reintentar</Button>
        </div>
      )}

      {errorQr && (
        <p role="alert" className="text-center mb-6 text-destructive">{errorQr}</p>
      )}

      {avisoPago && (
        <p
          role={avisoPago.tipo === "error" ? "alert" : "status"}
          className={cn(
            "mb-6 rounded-md px-3 py-2 text-center",
            avisoPago.tipo === "error" ? "bg-red-50 text-red-700" : "bg-bosque-50 text-bosque-800"
          )}
        >
          {avisoPago.texto}
        </p>
      )}

      {avisoCancelacion && (
        <p
          ref={refAvisoCancelacion}
          role="status"
          // Recibe el foco al cerrar el diálogo después de cancelar
          tabIndex={-1}
          className="mb-6 rounded-md bg-bosque-50 px-3 py-2 text-center text-bosque-800"
        >
          {avisoCancelacion}
        </p>
      )}

      {!error && !(cargando && reservas.length === 0) && (
        <Tabs defaultValue="pendiente" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-8">
            {PESTANAS.map((p) => (
              <TabsTrigger key={p.valor} value={p.valor}>{p.titulo}</TabsTrigger>
            ))}
          </TabsList>
          {PESTANAS.map((p) => (
            <TabsContent key={p.valor} value={p.valor}>{renderizarTarjetas(p.valor)}</TabsContent>
          ))}
        </Tabs>
      )}

      <DialogoCancelacion
        reserva={reservaACancelar}
        token={token}
        onCerrar={() => setReservaACancelar(null)}
        onCancelada={alCancelar}
        devolverFoco={devolverFoco}
      />
    </div>
  );
}
