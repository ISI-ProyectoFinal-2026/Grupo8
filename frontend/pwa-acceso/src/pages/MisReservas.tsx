import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { formatearMonto } from "@/lib/cotizacion";
import { formatearFecha } from "@/lib/fechas";
import {
  agruparReservas,
  obtenerMisReservas,
  type CategoriaReserva,
  type ReservaDetalle,
} from "@/lib/misReservas";
import { CalendarX2, QrCode, XCircle, RefreshCw } from "lucide-react";

// URL base del backend (se puede sobreescribir con VITE_API_URL en el .env del frontend)
const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

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

      const response = await fetch(`${API_URL}/api/payments/reconcile/${reservaId}`);
      const data = await response.json();

      if (response.ok) {
        if (data.status === "reconciliado") {
          alert(`¡Éxito! ${data.message}`);
          // La reserva pasó a pagada: recargamos la lista para que cambie de pestaña
          await cargarReservas();
        } else {
          alert(`Información: ${data.message}`);
        }
      } else {
        alert(`Error del servidor: ${data.detail || "No se pudo verificar"}`);
      }
    } catch (error) {
      console.error("Error consultando API:", error);
      alert("Error de red al intentar comunicarse con el servidor.");
    } finally {
      setReconciliandoId(null);
    }
  };

  // Sin sesión no hay reservas propias para mostrar
  if (!token) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-zinc-900 mb-6">Mis Reservas</h1>
        <div className="text-center py-12 text-zinc-600 space-y-4">
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
        <div className="text-center py-12 text-zinc-500">
          <CalendarX2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
          No hay reservas en esta categoría.
        </div>
      );
    }

    return filtradas.map((reserva) => (
      <Card key={reserva.id} className="mb-4">
        <CardHeader className="pb-3 flex flex-row items-center justify-between bg-zinc-50 rounded-t-xl border-b">
          <div>
            <CardTitle className="text-lg">Reserva {reserva.id.slice(0, 8)}...</CardTitle>
            <p className="text-sm text-zinc-500">
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
                 className={
                   categoria === 'proxima' ? 'bg-green-600' :
                   categoria === 'pendiente' ? 'bg-yellow-500 hover:bg-yellow-600' : ''
                 }>
            {reserva.estado_reserva.toUpperCase()}
          </Badge>
        </CardHeader>
        <CardContent className="pt-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-xl font-bold text-zinc-900">{formatearMonto(reserva.monto_total)}</div>
          <div className="flex gap-2 w-full md:w-auto">

            {/* Lógica para reservas PAGADAS / PRÓXIMAS */}
            {categoria === 'proxima' && (
              <>
                <Button variant="outline" className="flex-1 md:flex-none flex gap-2 border-red-200 text-red-600 hover:bg-red-50">
                  <XCircle className="w-4 h-4" /> Cancelar
                </Button>
                <Button className="flex-1 md:flex-none flex gap-2 bg-zinc-900">
                  <QrCode className="w-4 h-4" /> Descargar QR
                </Button>
              </>
            )}

            {/* Lógica para reservas PENDIENTES */}
            {categoria === 'pendiente' && (
              <Button
                onClick={() => verificarPago(reserva.id)}
                disabled={reconciliandoId === reserva.id}
                className="flex-1 md:flex-none flex gap-2 bg-yellow-500 hover:bg-yellow-600 text-white"
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
      <h1 className="text-3xl font-bold text-zinc-900 mb-6">Mis Reservas</h1>

      {cargando && reservas.length === 0 && (
        <p role="status" className="text-center py-12 text-zinc-500">Cargando tus reservas…</p>
      )}

      {error && (
        <div role="alert" className="text-center py-8 text-red-600 space-y-3">
          <p>{error}</p>
          <Button variant="outline" onClick={() => cargarReservas()}>Reintentar</Button>
        </div>
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
    </div>
  );
}
