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
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sumarDias } from "@/lib/fechas";
import {
  describirPrecio,
  esPorUnidad,
  obtenerTiposActivos,
  validarCantidadParaTipo,
  validarNochesParaTipo,
  type TipoReserva,
} from "@/lib/tiposReserva";
import { hoyISO, MAX_NOCHES, soloDigitos, validarFechasEstadia } from "@/lib/validaciones";

export default function Home() {
  const navigate = useNavigate();
  const [fecha, setFecha] = useState("");
  const [noches, setNoches] = useState("");
  const [personas, setPersonas] = useState("");
  const [tipoId, setTipoId] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});

  // Los tipos y sus precios vienen del backend
  const [tipos, setTipos] = useState<TipoReserva[]>([]);
  const [cargandoTipos, setCargandoTipos] = useState(true);
  const [errorTipos, setErrorTipos] = useState(false);

  const cargarTipos = useCallback((signal?: AbortSignal) => {
    setCargandoTipos(true);
    setErrorTipos(false);
    obtenerTiposActivos(signal)
      .then(setTipos)
      .catch(() => {
        if (!signal?.aborted) setErrorTipos(true);
      })
      .finally(() => {
        if (!signal?.aborted) setCargandoTipos(false);
      });
  }, []);

  useEffect(() => {
    const controlador = new AbortController();
    cargarTipos(controlador.signal);
    return () => controlador.abort();
  }, [cargarTipos]);

  const tipo = tipos.find((t) => t.id === tipoId);
  const sinTipos = !cargandoTipos && !errorTipos && tipos.length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nuevos: Record<string, string> = {};

    if (!tipo) nuevos.tipo = "Seleccioná un tipo de reserva.";

    if (tipo) {
      const ePersonas = validarCantidadParaTipo(personas, tipo);
      if (ePersonas) nuevos.personas = ePersonas;
    } else if (!personas.trim()) {
      nuevos.personas = "La cantidad de personas es obligatoria.";
    }

    const eNoches = tipo ? validarNochesParaTipo(noches, tipo) : null;
    if (eNoches) nuevos.noches = eNoches;

    // 0 noches = pasar el día: el egreso es el mismo día del ingreso
    const fechaEgreso =
      tipo && !eNoches && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
        ? sumarDias(fecha, Number(noches))
        : fecha;

    const fechas = validarFechasEstadia(fecha, fechaEgreso);
    if (fechas.ingreso) nuevos.fecha = fechas.ingreso;

    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) return;

    // Viaja el tipo completo: Disponibilidad y Reservas usan su nombre, precio y forma de cobro
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
          <CardDescription>Ingresá los datos de tu viaje para ver el precio</CardDescription>
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
                <Label htmlFor="personas">
                  Cantidad de personas{tipo ? ` (máx. ${tipo.max_personas})` : ""}
                </Label>
                <Input
                  id="personas"
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
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
              {cargandoTipos ? (
                <p role="status" className="text-sm text-zinc-500">Cargando tipos de reserva…</p>
              ) : errorTipos ? (
                <div className="space-y-2">
                  <p role="alert" className="text-sm text-red-600">
                    No pudimos cargar los tipos de reserva. Revisá tu conexión.
                  </p>
                  <Button type="button" variant="outline" onClick={() => cargarTipos()}>
                    Reintentar
                  </Button>
                </div>
              ) : sinTipos ? (
                <p role="status" className="text-sm text-zinc-600">
                  No hay tipos de reserva disponibles por el momento.
                </p>
              ) : (
                <Select required value={tipoId} onValueChange={setTipoId}>
                  <SelectTrigger id="tipo">
                    <SelectValue placeholder="Seleccioná una opción..." />
                  </SelectTrigger>
                  <SelectContent>
                    {tipos.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.nombre} — {describirPrecio(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {errores.tipo && (
                <p role="alert" className="text-sm text-red-600">
                  {errores.tipo}
                </p>
              )}
              {tipo && (
                <div className="space-y-2">
                  <Label htmlFor="noches">
                    {esPorUnidad(tipo)
                      ? `Cantidad de noches (mín. 1, máx. ${MAX_NOCHES})`
                      : `Cantidad de noches (0 para pasar el día, máx. ${MAX_NOCHES})`}
                  </Label>
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
            <Button
              type="submit"
              disabled={cargandoTipos || errorTipos || sinTipos}
              className="w-full bg-green-600 hover:bg-green-700 text-md h-12"
            >
              Continuar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
