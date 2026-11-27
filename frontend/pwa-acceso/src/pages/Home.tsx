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
import { DisponibilidadDias } from "@/components/DisponibilidadDias";
import { ErrorDeCampo } from "@/components/ErrorDeCampo";
import { CAMPING } from "@/lib/camping";
import { useDisponibilidad } from "@/lib/disponibilidad";
import { atributosDeError, enfocarPrimerError } from "@/lib/errorDeCampo";
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

  // Disponibilidad del día elegido y los siguientes. Con noches válidas también la de la estadía,
  // que se calcula con la misma cuenta que valida la reserva
  const nochesElegidas = /^\d+$/.test(noches) ? Number(noches) : 0;
  const egresoDeLaEstadia =
    /^\d{4}-\d{2}-\d{2}$/.test(fecha) && nochesElegidas >= 1 && nochesElegidas <= MAX_NOCHES
      ? sumarDias(fecha, nochesElegidas)
      : null;
  const disponibilidad = useDisponibilidad(fecha, egresoDeLaEstadia);
  const personasElegidas = /^\d+$/.test(personas) ? Number(personas) : null;

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

    // Con la disponibilidad ya consultada no se deja seguir con un día completo ni con una estadía
    // que no tiene lugares para todas las personas. Si no se pudo consultar, decide el backend al reservar
    const { datos } = disponibilidad;
    if (datos && !nuevos.fecha) {
      if (datos.dias.find((d) => d.fecha === fecha)?.completo) {
        nuevos.fecha = "Ese día está completo. Elegí otro día de la lista.";
      } else if (datos.estadia && !nuevos.personas && personasElegidas !== null && personasElegidas > datos.estadia.disponibles) {
        nuevos.personas = `Para esa estadía quedan ${datos.estadia.disponibles} ${datos.estadia.disponibles === 1 ? "lugar" : "lugares"}. Elegí otras fechas o menos personas.`;
      }
    }

    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) {
      enfocarPrimerError();
      return;
    }

    // Viaja el tipo completo: Disponibilidad y Reservas usan su nombre, precio y forma de cobro
    navigate("/disponibilidad", { state: { fecha, fechaEgreso, personas, tipo } });
  };

  return (
    <div className="container mx-auto px-4 pt-4 pb-10 max-w-3xl">
      <div className="text-center mb-8">
        <h1 className="text-4xl sm:text-5xl font-semibold text-foreground mb-3">
          Bienvenidos a {CAMPING.nombre}
        </h1>
        <p className="text-lg text-muted-foreground">
          Encontrá tu lugar ideal. Reservá tu estadía hoy mismo.
        </p>
      </div>

      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">Reservá tu lugar</CardTitle>
          <CardDescription>Ingresá los datos de tu viaje para ver el precio</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fecha">Fecha de ingreso</Label>
                <Input
                  id="fecha"
                  type="date"
                  required
                  min={hoyISO()}
                  value={fecha}
                  {...atributosDeError("fecha", errores.fecha)}
                  onChange={(e) => setFecha(e.target.value)}
                />
                <ErrorDeCampo idCampo="fecha" mensaje={errores.fecha} />
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
                  {...atributosDeError("personas", errores.personas)}
                  onChange={(e) => setPersonas(soloDigitos(e.target.value))}
                />
                <ErrorDeCampo idCampo="personas" mensaje={errores.personas} />
              </div>
            </div>

            <DisponibilidadDias
              disponibilidad={disponibilidad}
              fechaElegida={fecha}
              personas={personasElegidas}
              onElegir={setFecha}
            />

            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo de reserva</Label>
              {cargandoTipos ? (
                <p role="status" className="text-sm text-muted-foreground">Cargando tipos de reserva…</p>
              ) : errorTipos ? (
                <div className="space-y-2">
                  <p role="alert" className="text-sm text-destructive">
                    No pudimos cargar los tipos de reserva. Revisá tu conexión.
                  </p>
                  <Button type="button" variant="outline" onClick={() => cargarTipos()}>
                    Reintentar
                  </Button>
                </div>
              ) : sinTipos ? (
                <p role="status" className="text-sm text-muted-foreground">
                  No hay tipos de reserva disponibles por el momento.
                </p>
              ) : (
                <Select required value={tipoId} onValueChange={setTipoId}>
                  <SelectTrigger id="tipo" {...atributosDeError("tipo", errores.tipo)}>
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
              <ErrorDeCampo idCampo="tipo" mensaje={errores.tipo} />
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
                    {...atributosDeError("noches", errores.noches)}
                    onChange={(e) => setNoches(soloDigitos(e.target.value))}
                  />
                  <ErrorDeCampo idCampo="noches" mensaje={errores.noches} />
                </div>
              )}
            </div>
            <Button
              type="submit"
              disabled={cargandoTipos || errorTipos || sinTipos}
              size="lg"
              className="w-full"
            >
              Continuar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
