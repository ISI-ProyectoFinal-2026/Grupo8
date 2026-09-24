import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarX2, QrCode, XCircle } from "lucide-react";

// Mock de datos para probar la interfaz
const reservasMock = [
  { id: "RES-001", fecha: "2026-11-15", tipo: "Cabaña", estado: "proxima", total: "$25.000" },
  { id: "RES-002", fecha: "2026-05-10", tipo: "Carpa", estado: "finalizada", total: "$5.000" },
  { id: "RES-003", fecha: "2026-02-20", tipo: "Entrada General", estado: "cancelada", total: "$3.000" },
];

export default function MisReservas() {
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
            <CardTitle className="text-lg">Reserva {reserva.id}</CardTitle>
            <p className="text-sm text-zinc-500">{new Date(reserva.fecha).toLocaleDateString('es-AR')} - {reserva.tipo}</p>
          </div>
          <Badge variant={reserva.estado === 'cancelada' ? 'destructive' : 'default'} 
                 className={reserva.estado === 'proxima' ? 'bg-green-600' : ''}>
            {reserva.estado.toUpperCase()}
          </Badge>
        </CardHeader>
        <CardContent className="pt-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-xl font-bold text-zinc-900">{reserva.total}</div>
          <div className="flex gap-2 w-full md:w-auto">
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
      
      <Tabs defaultValue="proxima" className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-8">
          <TabsTrigger value="proxima">Próximas</TabsTrigger>
          <TabsTrigger value="finalizada">Finalizadas</TabsTrigger>
          <TabsTrigger value="cancelada">Canceladas</TabsTrigger>
        </TabsList>
        <TabsContent value="proxima">{renderizarTarjetas("proxima")}</TabsContent>
        <TabsContent value="finalizada">{renderizarTarjetas("finalizada")}</TabsContent>
        <TabsContent value="cancelada">{renderizarTarjetas("cancelada")}</TabsContent>
      </Tabs>
    </div>
  );
}