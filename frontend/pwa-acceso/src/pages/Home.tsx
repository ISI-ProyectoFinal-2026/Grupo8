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
import { sumarDias } from "@/lib/fechas";
import {
  hoyISO,
  MAX_NOCHES,
  MAX_PERSONAS,
  soloDigitos,
  validarCantidadPersonas,
  validarFechasEstadia,
  validarNoches,
} from "@/lib/validaciones";

export default function Home() {
  const navigate = useNavigate();
  const [fecha, setFecha] = useState("");
  const [noches, setNoches] = useState("");
  const [personas, setPersonas] = useState("");
  const [tipo, setTipo] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  
  const pideNoches = tipo !== "" && tipo !== "entrada_general";


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nuevos: Record<string, string> = {};

    if (!tipo) nuevos.tipo = "Seleccioná un tipo de reserva.";

    const ePersonas = validarCantidadPersonas(personas);
    if (ePersonas) nuevos.personas = ePersonas;

    const eNoches = pideNoches ? validarNoches(noches) : null;
    if (eNoches) nuevos.noches = eNoches;

    // Entrada general: egreso = ingreso. Resto: ingreso + noches.
    const fechaEgreso =
      pideNoches && !eNoches && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
        ? sumarDias(fecha, Number(noches))
        : fecha;

    const fechas = validarFechasEstadia(fecha, fechaEgreso);
    if (fechas.ingreso) nuevos.fecha = fechas.ingreso;

    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) return;

    // Disponibilidad y Reservas siguen recibiendo fechaEgreso, no cambian
    navigate("/disponibilidad", { state: { fecha, fechaEgreso, personas, tipo } });
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
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fecha">Fecha de ingreso</Label>
                <Input 
                  id="fecha" 
                  type="date" 
                  required
                  min={hoyISO()}
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
                {errores.fecha && (
                  <p role="alert" className="text-sm text-red-600">
                    {errores.fecha}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="personas">Cantidad de personas</Label>
                <Input
                  id="personas"
                  type="text"
                  inputMode="numeric"
                  maxLength={String(MAX_PERSONAS).length}
                  required
                  value={personas}
                  onChange={(e) => setPersonas(soloDigitos(e.target.value))}
                />
                {errores.personas && (
                  <p role="alert" className="text-sm text-red-600">
                    {errores.personas}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo de reserva</Label>
              <Select
                required
                value={tipo}
                onValueChange={(v) => {
                  setTipo(v);
                  if (v === "entrada_general") setNoches("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná una opción..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada_general">Entrada General (Pasar el día)</SelectItem>
                  <SelectItem value="carpa">Parcela para Carpa</SelectItem>
                  <SelectItem value="cabana">Cabaña</SelectItem>
                </SelectContent>
              </Select>
              {errores.tipo && (
                <p role="alert" className="text-sm text-red-600">
                  {errores.tipo}
                </p>
              )}
              {pideNoches && (
                <div className="space-y-2">
                  <Label htmlFor="noches">Cantidad de noches (máx. {MAX_NOCHES})</Label>
                  <Input
                    id="noches"
                    type="text"
                    inputMode="numeric"
                    maxLength={String(MAX_NOCHES).length}
                    value={noches}
                    onChange={(e) => setNoches(soloDigitos(e.target.value))}
                  />
                  {errores.noches && (
                    <p role="alert" className="text-sm text-red-600">{errores.noches}</p>
                  )}
                </div>
              )}
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