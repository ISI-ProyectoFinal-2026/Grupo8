import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarX2, QrCode, XCircle, RefreshCw } from "lucide-react";

// Mock de datos extendido con una reserva PENDIENTE
// IMPORTANTE: Cambiá "PONER-UUID-REAL-ACA" por el ID que usaste en Swagger
const reservasMock = [
  { id: "RES-001", fecha: "2026-11-15", tipo: "Cabaña", estado: "proxima", total: "$25.000" },
  { id: "RES-002", fecha: "2026-05-10", tipo: "Carpa", estado: "finalizada", total: "$5.000" },
  { id: "RES-003", fecha: "2026-02-20", tipo: "Entrada General", estado: "cancelada", total: "$3.000" },
  { id: "9de0ffbe-77ef-4b1c-8d4b-58f0beb138b7", fecha: "2026-10-10", tipo: "Cabaña", estado: "pendiente", total: "$25.000" },
];

export default function MisReservas() {
  // Estado para saber qué botón está cargando y evitar doble clic
  const [reconciliandoId, setReconciliandoId] = useState<string | null>(null);

  const verificarPago = async (reservaId: string) => {
    try {
      setReconciliandoId(reservaId);
      
      const response = await fetch(`http://127.0.0.1:8000/api/payments/reconcile/${reservaId}`);
      const data = await response.json();

      if (response.ok) {
        if (data.status === "reconciliado") {
          alert(`¡Éxito! ${data.message}`);
          // Aquí en el futuro se recargará la lista real de reservas
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

  const renderizarTarjetas = (filtroEstado: string) => {
    const filtradas = reservasMock.filter(r => r.estado === filtroEstado);
    
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
            <p className="text-sm text-zinc-500">{new Date(reserva.fecha).toLocaleDateString('es-AR')} - {reserva.tipo}</p>
          </div>
          <Badge variant={reserva.estado === 'cancelada' ? 'destructive' : 'default'} 
                 className={
                   reserva.estado === 'proxima' ? 'bg-green-600' : 
                   reserva.estado === 'pendiente' ? 'bg-yellow-500 hover:bg-yellow-600' : ''
                 }>
            {reserva.estado.toUpperCase()}
          </Badge>
        </CardHeader>
        <CardContent className="pt-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-xl font-bold text-zinc-900">{reserva.total}</div>
          <div className="flex gap-2 w-full md:w-auto">
            
            {/* Lógica para reservas PAGADAS / PRÓXIMAS */}
            {reserva.estado === 'proxima' && (
              <>
                <Button variant="outline" className="flex-1 md:flex-none flex gap-2 border-red-200 text-red-600 hover:bg-red-50">
                  <XCircle className="w-4 h-4" /> Cancelar
                </Button>
                <Button className="flex-1 md:flex-none flex gap-2 bg-zinc-900">
                  <QrCode className="w-4 h-4" /> Descargar QR
                </Button>
              </>
            )}
            
            {/* NUEVO: Lógica para reservas PENDIENTES */}
            {reserva.estado === 'pendiente' && (
              <Button 
                onClick={() => verificarPago(reserva.id)}
                disabled={reconciliandoId === reserva.id}
                className="flex-1 md:flex-none flex gap-2 bg-yellow-500 hover:bg-yellow-600 text-white"
              >
                <RefreshCw className={`w-4 h-4 ${reconciliandoId === reserva.id ? 'animate-spin' : ''}`} /> 
                {reconciliandoId === reserva.id ? 'Verificando...' : 'Verificar Pago'}
              </Button>
            )}

            {reserva.estado === 'finalizada' && (
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
      
      <Tabs defaultValue="pendiente" className="w-full">
        {/* Actualizamos el grid a 4 columnas */}
        <TabsList className="grid w-full grid-cols-4 mb-8">
          <TabsTrigger value="pendiente">Pendientes</TabsTrigger>
          <TabsTrigger value="proxima">Próximas</TabsTrigger>
          <TabsTrigger value="finalizada">Finalizadas</TabsTrigger>
          <TabsTrigger value="cancelada">Canceladas</TabsTrigger>
        </TabsList>
        <TabsContent value="pendiente">{renderizarTarjetas("pendiente")}</TabsContent>
        <TabsContent value="proxima">{renderizarTarjetas("proxima")}</TabsContent>
        <TabsContent value="finalizada">{renderizarTarjetas("finalizada")}</TabsContent>
        <TabsContent value="cancelada">{renderizarTarjetas("cancelada")}</TabsContent>
      </Tabs>
    </div>
  );
}