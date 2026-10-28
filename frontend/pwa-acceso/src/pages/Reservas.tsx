import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  cotizarReserva,
  formatearMonto,
  personasParaCotizar,
  type Cotizacion,
  type PersonaCotizar,
} from "@/lib/cotizacion";
import { formatearFecha } from "@/lib/fechas";
import {
  limpiarNombre,
  soloDigitos,
  validarCantidadPersonas,
  validarDni,
  validarEdad,
  validarEmail,
  validarNombre,
} from "@/lib/validaciones";
import { CalendarDays, CreditCard, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface Visitante {
  nombre: string;
  edad: string;
  condicion: string;
  dni: string;
}

// URL base del backend (se puede sobreescribir con VITE_API_URL en el .env del frontend)
const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

// --- DICCIONARIO DECLARADO AFUERA DEL COMPONENTE ---
const formatearTipo = (tipoCrudo: string) => {
  const nombres: Record<string, string> = {
    "cabana": "Cabaña",
    "entrada_general": "Entrada General",
    "carpa": "Parcela para Carpa"
  };
  return nombres[tipoCrudo] || (tipoCrudo ? tipoCrudo.replace('_', ' ') : 'Reserva General');
};

// Obtiene un mensaje legible de una respuesta de error del backend
// (422 de validación, 400 de cupos, etc.)
const extraerMensajeError = async (response: Response): Promise<string> => {
  try {
    const err = await response.json();
    if (Array.isArray(err.detail)) {
      return err.detail
        .map((d: { msg: string }) => d.msg.replace(/^Value error, /, ""))
        .join("\n");
    }
    if (typeof err.detail === "string") return err.detail;
  } catch {
    // la respuesta no traía JSON
  }
  return "No se pudo guardar la reserva. Intentá nuevamente.";
};

// Mensaje de error bajo un campo
const MensajeError = ({ texto }: { texto?: string }) =>
  texto ? (
    <p role="alert" className="mt-2 text-sm text-red-600">
      {texto}
    </p>
  ) : null;
// ---------------------------------------------------

export default function Reservas() {
  const location = useLocation();
  const navigate = useNavigate();

  // Rescatamos los datos que vienen del buscador y la disponibilidad con valores por defecto
  const { fecha, fechaEgreso, personas, tipo } = location.state || {};

  // Si no hay fecha, redirigimos al inicio para evitar pantallas en blanco
  useEffect(() => {
    if (!fecha) {
      navigate("/");
    }
  }, [fecha, navigate]);

  const cantidadPersonas = parseInt(personas) || 1;

  const [visitantes, setVisitantes] = useState<Visitante[]>(
    Array.from({ length: cantidadPersonas }, () => ({
      nombre: "", edad: "", condicion: "visitante", dni: ""
    }))
  );

  const [emailContacto, setEmailContacto] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});

  // El precio lo calcula el backend: acá solo se pide la cotización cuando cambia la edad
  // o la condición de alguien. Mientras falte alguna edad no hay nada que cotizar.
  const personasACotizar = personasParaCotizar(visitantes);
  const claveCotizacion = JSON.stringify(personasACotizar);
  const [cotizacion, setCotizacion] = useState<Cotizacion | null>(null);
  const [errorCotizacion, setErrorCotizacion] = useState(false);

  useEffect(() => {
    const aCotizar: PersonaCotizar[] | null = JSON.parse(claveCotizacion);
    setCotizacion(null);
    setErrorCotizacion(false);
    if (!aCotizar) return;

    const controlador = new AbortController();
    cotizarReserva(aCotizar, controlador.signal)
      .then(setCotizacion)
      .catch(() => {
        if (!controlador.signal.aborted) setErrorCotizacion(true);
      });
    return () => controlador.abort();
  }, [claveCotizacion]);

  const actualizarVisitante = (index: number, campo: keyof Visitante, valor: string) => {
    const nuevosVisitantes = [...visitantes];
    nuevosVisitantes[index][campo] = valor;
    if (campo === "condicion" && valor === "visitante") nuevosVisitantes[index].dni = "";
    setVisitantes(nuevosVisitantes);
  };

  // Valida todo el formulario antes de tocar el backend
  const validarFormulario = (): boolean => {
    const nuevos: Record<string, string> = {};

    const eEmail = validarEmail(emailContacto);
    if (eEmail) nuevos.email = eEmail;

    const eCantidad = validarCantidadPersonas(String(cantidadPersonas));
    if (eCantidad) nuevos.cantidad = eCantidad;

    visitantes.forEach((v, i) => {
      const eNombre = validarNombre(v.nombre);
      if (eNombre) nuevos[`nombre-${i}`] = eNombre;

      const eEdad = validarEdad(v.edad);
      if (eEdad) nuevos[`edad-${i}`] = eEdad;

      if (v.condicion === "socio") {
        const eDni = validarDni(v.dni);
        if (eDni) nuevos[`dni-${i}`] = eDni;
      }
    });

    setErrores(nuevos);

    if (Object.keys(nuevos).length > 0) {
      // Llevamos al usuario al primer error, aunque esté fuera de pantalla
      setTimeout(() => {
        document
          .querySelector('[role="alert"]')
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validarFormulario()) return;

    try {
      // 0. Obtenemos un usuario que exista en la base de datos ACTUAL.
      // (Temporal: cuando haya login real, el user_id saldrá del usuario autenticado.)
      const usuarioResponse = await fetch(`${API_URL}/usuarios/prueba`);
      if (!usuarioResponse.ok) {
        alert("No se pudo obtener un usuario válido para crear la reserva.");
        return;
      }
      const { user_id: userId } = await usuarioResponse.json();

      // 1. PRIMERO: Guardamos la reserva en la base de datos
      const reservaResponse = await fetch(`${API_URL}/reservas/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha_ingreso: fecha,
          fecha_egreso: fechaEgreso || fecha, // si no vino egreso, es una reserva por el día
          user_id: userId,
          // El titular es la primera persona; el precio lo calcula el backend con estos datos
          personas: visitantes.map((v) => ({
            nombre: v.nombre.trim(),
            edad: Number(v.edad),
            condicion: v.condicion,
            dni: v.condicion === "socio" ? v.dni.trim() : undefined,
          })),
          email: emailContacto.trim()
        })
      });

      if (!reservaResponse.ok) {
        // Mostramos el motivo real (validación, cupos, etc.) en lugar de un mensaje genérico
        alert(await extraerMensajeError(reservaResponse));
        return;
      }

      const reservaData = await reservaResponse.json();
      const reservaId = reservaData.id; // ¡Este es el ID que generó PostgreSQL!

      // 2. SEGUNDO: Llamamos a Mercado Pago pasándole el ID de la reserva
      const paymentResponse = await fetch(`${API_URL}/api/payments/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `${formatearTipo(tipo)} - ${cantidadPersonas} personas`,
          reserva_id: reservaId // <- EL PUENTE HACIA TU WEBHOOK
        }),
      });

      // 3. TERCERO: Leemos la respuesta y decidimos qué hacer
      if (paymentResponse.ok) {
        // Si el backend devolvió 200/201, leemos el JSON y redirigimos
        const paymentData = await paymentResponse.json();
        if (paymentData.init_point) {
          window.location.href = paymentData.init_point;
        }
      } else {
        // Falló, mostramos mensaje genérico y limpio
        alert("Error al conectar con Mercado Pago. Intentá nuevamente.");
      }

    } catch (error) {
      console.error("Error en el proceso:", error);
      alert("Ocurrió un error de red. Verificá que el servidor backend esté encendido.");
    }
  };

  if (!fecha) return null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <h1 className="text-3xl font-bold text-zinc-900 mb-8">Completá tu Reserva</h1>

      {/* noValidate: desactiva los mensajes nativos del navegador (en inglés)
          y usamos los nuestros, en español */}
      <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* COLUMNA IZQUIERDA: Formulario Dinámico */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Email de Contacto</CardTitle>
              <CardDescription>A este correo enviaremos los QR de acceso y el comprobante de pago.</CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                type="email"
                required
                placeholder="ejemplo@correo.com"
                value={emailContacto}
                aria-invalid={!!errores.email}
                onChange={(e) => setEmailContacto(e.target.value)}
              />
              <MensajeError texto={errores.email} />
            </CardContent>
          </Card>

          {visitantes.map((visitante, index) => (
            <Card key={index} className="border-zinc-200">
              <CardHeader className="bg-zinc-50 border-b border-zinc-100 pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="w-5 h-5 text-zinc-500" />
                  Visitante {index + 1}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nombre completo</Label>
                  <Input
                    required
                    maxLength={100}
                    value={visitante.nombre}
                    aria-invalid={!!errores[`nombre-${index}`]}
                    onChange={(e) => actualizarVisitante(index, "nombre", limpiarNombre(e.target.value))}
                  />
                  <MensajeError texto={errores[`nombre-${index}`]} />
                </div>
                <div className="space-y-2">
                  <Label>Edad</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    required
                    value={visitante.edad}
                    aria-invalid={!!errores[`edad-${index}`]}
                    onChange={(e) => actualizarVisitante(index, "edad", soloDigitos(e.target.value))}
                  />
                  <MensajeError texto={errores[`edad-${index}`]} />
                </div>
                <div className="space-y-2">
                  <Label>Condición</Label>
                  <Select
                    value={visitante.condicion}
                    onValueChange={(val) => actualizarVisitante(index, "condicion", val)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="visitante">Visitante General</SelectItem>
                      <SelectItem value="socio">Socio del Camping</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {visitante.condicion === "socio" && (
                  <div className="space-y-2">
                    <Label>DNI (Obligatorio para socios)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={8}
                      required
                      value={visitante.dni}
                      aria-invalid={!!errores[`dni-${index}`]}
                      onChange={(e) => actualizarVisitante(index, "dni", soloDigitos(e.target.value))}
                    />
                    <MensajeError texto={errores[`dni-${index}`]} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* COLUMNA DERECHA: Resumen y Pago */}
        <div>
          <Card className="sticky top-6 shadow-md border-green-100">
            <CardHeader className="bg-zinc-50 rounded-t-lg">
              <CardTitle>Resumen de Compra</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="flex justify-between text-zinc-600">
                <span className="flex items-center gap-2"><CalendarDays className="w-4 h-4"/> Fecha</span>
                <span className="font-medium text-zinc-900">
                  {fecha ? formatearFecha(fecha) : ''}
                  {fechaEgreso && fechaEgreso !== fecha ? ` al ${formatearFecha(fechaEgreso)}` : ''}
                </span>
              </div>
              <div className="flex justify-between text-zinc-600">
                <span>Tipo de reserva</span>
                <span className="font-medium text-zinc-900">
                  {formatearTipo(tipo)}
                </span>
              </div>

              <Separator />

              <div className="flex justify-between text-zinc-600">
                <span>Subtotal ({cantidadPersonas} pers.)</span>
                <span>{cotizacion ? formatearMonto(cotizacion.subtotal) : "—"}</span>
              </div>
              <MensajeError texto={errores.cantidad} />

              {cotizacion && cotizacion.descuento_total > 0 && (
                <div className="flex justify-between text-green-600 font-medium">
                  <span>Descuentos</span>
                  <span>-{formatearMonto(cotizacion.descuento_total)}</span>
                </div>
              )}

              <Separator />

              <div className="flex justify-between items-center">
                <span className="text-lg font-bold text-zinc-900">Total a pagar</span>
                <span className="text-2xl font-black text-green-700">
                  {cotizacion ? formatearMonto(cotizacion.total) : "—"}
                </span>
              </div>
              {!cotizacion && (
                <p role="status" className="text-sm text-zinc-500">
                  {errorCotizacion
                    ? "No pudimos calcular el precio. Revisá tu conexión e intentá nuevamente."
                    : personasACotizar
                      ? "Calculando el precio…"
                      : "Completá la edad de cada persona para ver el precio."}
                </p>
              )}
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full bg-[#009EE3] hover:bg-[#0086c2] text-white h-14 text-lg font-semibold flex gap-2">
                <CreditCard className="w-5 h-5" />
                Pagar con Mercado Pago
              </Button>
            </CardFooter>
          </Card>
        </div>
      </form>
    </div>
  );
}