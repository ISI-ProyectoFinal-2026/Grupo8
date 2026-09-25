import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { CalendarDays, CreditCard, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface Visitante {
  nombre: string;
  edad: string;
  condicion: string;
  dni: string;
}

// --- DICCIONARIO DECLARADO AFUERA DEL COMPONENTE ---
const formatearTipo = (tipoCrudo: string) => {
  const nombres: Record<string, string> = {
    "cabana": "Cabaña",
    "entrada_general": "Entrada General",
    "carpa": "Parcela para Carpa"
  };
  return nombres[tipoCrudo] || (tipoCrudo ? tipoCrudo.replace('_', ' ') : 'Reserva General');
};
// ---------------------------------------------------

export default function Reservas() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Rescatamos los datos que vienen del buscador y la disponibilidad con valores por defecto
  const { fecha, personas, tipo, precio } = location.state || {};
  const precioBase = precio || 5000; // Valor de respaldo por seguridad

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
  const [total, setTotal] = useState(cantidadPersonas * precioBase);
  const [descuentoAplicado, setDescuentoAplicado] = useState(0);

  useEffect(() => {
    const calcularTarifasBackend = async () => {
      try {
        const cantidadSocios = visitantes.filter(v => v.condicion === "socio").length;
        const subtotal = cantidadPersonas * precioBase;
        const descuento = cantidadSocios * (precioBase * 0.5); 
        
        setDescuentoAplicado(descuento);
        setTotal(subtotal - descuento);
      } catch (error) {
        console.error("Error al calcular tarifas", error);
      }
    };

    calcularTarifasBackend();
  }, [visitantes, cantidadPersonas, precioBase]);

  const actualizarVisitante = (index: number, campo: keyof Visitante, valor: string) => {
    const nuevosVisitantes = [...visitantes];
    nuevosVisitantes[index][campo] = valor;
    if (campo === "condicion" && valor === "visitante") nuevosVisitantes[index].dni = "";
    setVisitantes(nuevosVisitantes);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!emailContacto) {
      alert("Por favor ingresa un email de contacto.");
      return;
    }

    try {
      // 1. Llamamos a nuestro backend (FastAPI)
      const response = await fetch("http://127.0.0.1:8000/api/payments/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // --- ACÁ USAMOS LA FUNCIÓN PARA TRADUCIR EL TÍTULO ---
          title: `${formatearTipo(tipo)} - ${cantidadPersonas} personas`,
          unit_price: total,
          payer_email: emailContacto
        }),
      });

      const data = await response.json();

      // 2. Si el backend nos devuelve el link, redirigimos al usuario
      if (response.ok && data.init_point) {
        window.location.href = data.init_point;
      } else {
        alert("Error al conectar con Mercado Pago. Intentá nuevamente.");
      }
    } catch (error) {
      console.error("Error en el pago:", error);
      alert("Ocurrió un error de red. Verificá que el servidor backend esté encendido.");
    }
  };

  if (!fecha) return null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <h1 className="text-3xl font-bold text-zinc-900 mb-8">Completá tu Reserva</h1>
      
      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
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
                onChange={(e) => setEmailContacto(e.target.value)}
              />
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
                    value={visitante.nombre}
                    onChange={(e) => actualizarVisitante(index, "nombre", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Edad</Label>
                  <Input 
                    type="number" 
                    required 
                    min="0"
                    value={visitante.edad}
                    onChange={(e) => actualizarVisitante(index, "edad", e.target.value)}
                  />
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
                      required 
                      type="number"
                      value={visitante.dni}
                      onChange={(e) => actualizarVisitante(index, "dni", e.target.value)}
                    />
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
                  {fecha ? new Date(fecha).toLocaleDateString('es-AR') : ''}
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
                <span>${(cantidadPersonas * precioBase).toLocaleString('es-AR')}</span>
              </div>
              
              {descuentoAplicado > 0 && (
                <div className="flex justify-between text-green-600 font-medium">
                  <span>Descuento socios</span>
                  <span>-${descuentoAplicado.toLocaleString('es-AR')}</span>
                </div>
              )}
              
              <Separator />
              
              <div className="flex justify-between items-center">
                <span className="text-lg font-bold text-zinc-900">Total a pagar</span>
                <span className="text-2xl font-black text-green-700">${total.toLocaleString('es-AR')}</span>
              </div>
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