import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();
  const [fecha, setFecha] = useState("");
  const [personas, setPersonas] = useState("");
  const [tipo, setTipo] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Pasamos los parámetros de búsqueda a la pantalla de disponibilidad
    navigate("/disponibilidad", { state: { fecha, personas, tipo } });
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-extrabold text-zinc-900 tracking-tight mb-4">
          ¡Bienvenidos a Qamp!
        </h1>
        <p className="text-lg text-zinc-600">
          Encontrá tu lugar ideal. Reservá tu estadía hoy mismo.
        </p>
      </div>

      <Card className="shadow-lg border-zinc-200">
        <CardHeader>
          <CardTitle>Buscador de Disponibilidad</CardTitle>
          <CardDescription>Ingresá los datos de tu viaje para ver los cupos</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fecha">Fecha de ingreso</Label>
                <Input 
                  id="fecha" 
                  type="date" 
                  required 
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="personas">Cantidad de personas</Label>
                <Input 
                  id="personas" 
                  type="number" 
                  min="1" 
                  max="10" 
                  required 
                  value={personas}
                  onChange={(e) => setPersonas(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo de reserva</Label>
              <Select required value={tipo} onValueChange={setTipo}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná una opción..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada_general">Entrada General (Pasar el día)</SelectItem>
                  <SelectItem value="carpa">Parcela para Carpa</SelectItem>
                  <SelectItem value="cabana">Cabaña</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-md h-12">
              Consultar disponibilidad
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}