import { type FormEvent, useRef, useState } from 'react';
import { Mail, MapPin, Phone } from 'lucide-react';
import { ErrorDeCampo } from '@/components/ErrorDeCampo';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CAMPING } from '@/lib/camping';
import {
  enviarContacto,
  type ErroresContacto,
  MENSAJE_MAX,
  validarContacto,
} from '@/lib/contacto';
import { atributosDeError, enfocarPrimerError } from '@/lib/errorDeCampo';
import { limpiarNombre } from '@/lib/validaciones';

const ID_NOMBRE = 'nombre';
const ID_EMAIL = 'email';
const ID_MENSAJE = 'mensaje';

function Dato({
  icono: Icono,
  titulo,
  children,
}: {
  icono: typeof Phone;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 bg-bosque-100 rounded-full flex items-center justify-center text-bosque-700">
        <Icono className="w-5 h-5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-tierra-900">{titulo}</p>
        <p className="text-tierra-600">{children}</p>
      </div>
    </div>
  );
}

export default function Contacto() {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [errores, setErrores] = useState<ErroresContacto>({});
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // setEnviando es asíncrono: la ref corta un segundo envío que llegue antes de que React vuelva a dibujar
  const enCurso = useRef(false);

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (enCurso.current) return;

    const erroresDeValidacion = validarContacto({ nombre, email, mensaje });
    setErrores(erroresDeValidacion);
    setError(null);
    if (Object.keys(erroresDeValidacion).length > 0) {
      enfocarPrimerError();
      return;
    }

    enCurso.current = true;
    setEnviando(true);
    try {
      setAviso(await enviarContacto({ nombre, email, mensaje }));
      setNombre('');
      setEmail('');
      setMensaje('');
    } catch (e) {
      // Los datos escritos se conservan para reintentar
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'No pudimos enviar tu mensaje. Intentá nuevamente en unos minutos.'
      );
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  };

  const escribirOtro = () => {
    setAviso(null);
    setError(null);
  };

  const hayDatos = CAMPING.telefono || CAMPING.email || CAMPING.direccion;

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Datos del camping: salen de la configuración (lib/camping.ts), no de este archivo */}
        <div>
          <h1 className="text-3xl font-bold text-tierra-900 mb-6">Comunicate con nosotros</h1>
          <p className="text-tierra-600 mb-8">
            Si tenés alguna duda escribinos y te responderemos lo más rápido posible.
          </p>

          {hayDatos && (
            <div className="space-y-6">
              {CAMPING.telefono && (
                <Dato icono={Phone} titulo="Teléfono / WhatsApp">
                  <a
                    href={`tel:${CAMPING.telefono.replace(/\s/g, '')}`}
                    className="hover:underline"
                  >
                    {CAMPING.telefono}
                  </a>
                </Dato>
              )}
              {CAMPING.email && (
                <Dato icono={Mail} titulo="Correo Electrónico">
                  <a href={`mailto:${CAMPING.email}`} className="hover:underline">
                    {CAMPING.email}
                  </a>
                </Dato>
              )}
              {CAMPING.direccion && (
                <Dato icono={MapPin} titulo="Ubicación">
                  {CAMPING.direccion}
                </Dato>
              )}
            </div>
          )}
        </div>

        {/* Formulario */}
        <Card className="shadow-lg border-tierra-200">
          <CardHeader>
            <CardTitle>Envianos un mensaje</CardTitle>
            <CardDescription>Completá el formulario y te contactaremos por email.</CardDescription>
          </CardHeader>
          <CardContent>
            {aviso ? (
              <div className="space-y-4">
                <p
                  role="status"
                  className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800"
                >
                  {aviso}
                </p>
                <Button variant="outline" onClick={escribirOtro}>
                  Enviar otro mensaje
                </Button>
              </div>
            ) : (
              <form noValidate onSubmit={(e) => void enviar(e)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={ID_NOMBRE}>Nombre completo</Label>
                  <Input
                    id={ID_NOMBRE}
                    required
                    autoComplete="name"
                    maxLength={100}
                    placeholder="Tu nombre"
                    value={nombre}
                    {...atributosDeError(ID_NOMBRE, errores.nombre)}
                    onChange={(e) => setNombre(limpiarNombre(e.target.value))}
                  />
                  <ErrorDeCampo idCampo={ID_NOMBRE} mensaje={errores.nombre} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={ID_EMAIL}>Correo electrónico</Label>
                  <Input
                    id={ID_EMAIL}
                    type="email"
                    required
                    autoComplete="email"
                    maxLength={254}
                    placeholder="ejemplo@correo.com"
                    value={email}
                    {...atributosDeError(ID_EMAIL, errores.email)}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <ErrorDeCampo idCampo={ID_EMAIL} mensaje={errores.email} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={ID_MENSAJE}>Mensaje</Label>
                  <Textarea
                    id={ID_MENSAJE}
                    required
                    maxLength={MENSAJE_MAX}
                    placeholder="Escribí tu consulta acá..."
                    className="min-h-[120px]"
                    value={mensaje}
                    {...atributosDeError(ID_MENSAJE, errores.mensaje)}
                    onChange={(e) => setMensaje(e.target.value)}
                  />
                  <ErrorDeCampo idCampo={ID_MENSAJE} mensaje={errores.mensaje} />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={enviando}
                  className="w-full bg-bosque-600 hover:bg-bosque-700 h-11 text-md mt-4"
                >
                  {enviando ? 'Enviando…' : 'Enviar mensaje'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
