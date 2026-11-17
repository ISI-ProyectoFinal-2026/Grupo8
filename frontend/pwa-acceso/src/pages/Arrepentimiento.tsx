import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { MENSAJE_SOLICITUD, solicitarEnlaces } from '@/lib/arrepentimiento';
import { atributosDeError } from '@/lib/errorDeCampo';
import { validarEmail } from '@/lib/validaciones';

const ID_EMAIL = 'email-arrepentimiento';

/**
 * Botón de arrepentimiento (Disposición 954/2025): sin cuenta, solo con el email de la reserva.
 * Los enlaces para cancelar llegan por correo, uno por reserva.
 */
export default function Arrepentimiento() {
  const [email, setEmail] = useState('');
  const [errorEmail, setErrorEmail] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    const errorDeValidacion = validarEmail(email);
    setErrorEmail(errorDeValidacion);
    setError(null);
    if (errorDeValidacion) return;
    setEnviando(true);
    try {
      await solicitarEnlaces(email);
      setEnviado(true);
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'No pudimos enviar el correo. Intentá nuevamente.'
      );
    } finally {
      setEnviando(false);
    }
  };

  const usarOtroEmail = () => {
    setEnviado(false);
    setEmail('');
  };

  return (
    <div className="container mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold text-tierra-900">
        Botón de arrepentimiento
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>Cancelá tu reserva sin iniciar sesión</CardTitle>
          <CardDescription>
            Ingresá el email con el que hiciste la reserva. Te enviamos un
            enlace por cada reserva pagada y próxima, para que elijas cuál
            cancelar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {enviado ? (
            <div className="space-y-4">
              <p
                role="status"
                className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800"
              >
                {MENSAJE_SOLICITUD}
              </p>
              <p className="text-sm text-tierra-600">
                Revisá también la carpeta de correo no deseado. Los enlaces
                vencen al rato: si no los usás a tiempo, podés pedir otros.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={usarOtroEmail}>
                  Usar otro email
                </Button>
                <Button asChild>
                  <Link to="/">Volver al inicio</Link>
                </Button>
              </div>
            </div>
          ) : (
            <form noValidate onSubmit={(e) => void enviar(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={ID_EMAIL}>Email de la reserva</Label>
                <Input
                  id={ID_EMAIL}
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="ejemplo@correo.com"
                  value={email}
                  {...atributosDeError(ID_EMAIL, errorEmail)}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <ErrorDeCampo idCampo={ID_EMAIL} mensaje={errorEmail} />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={enviando}>
                {enviando ? 'Enviando…' : 'Enviar enlace'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
