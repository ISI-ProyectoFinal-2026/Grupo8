import { CAMPING } from "@/lib/camping";
import { Clock, Mail, MapPin, Phone, Share2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

function Columna({ titulo, icono: Icono, children }: { titulo: string; icono: LucideIcon; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Icono className="h-4 w-4 text-primary" aria-hidden="true" />
        {titulo}
      </h2>
      <div className="space-y-1.5 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

/** Pie de la web de reservas: datos del camping (del .env) y el botón de arrepentimiento. */
export function Footer() {
  const contacto = CAMPING.email || CAMPING.telefono;
  const redes = CAMPING.instagram || CAMPING.facebook;

  return (
    <footer className="relative border-t border-tierra-200 bg-white">
      <div className="container mx-auto grid grid-cols-1 gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        {contacto && (
          <Columna titulo="Contacto" icono={Phone}>
            {CAMPING.email && (
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4" aria-hidden="true" />
                <a href={`mailto:${CAMPING.email}`} className="hover:text-foreground hover:underline">
                  {CAMPING.email}
                </a>
              </p>
            )}
            {CAMPING.telefono && (
              <p className="flex items-center gap-2">
                <Phone className="h-4 w-4" aria-hidden="true" />
                <a href={`tel:${CAMPING.telefono.replace(/\s/g, "")}`} className="hover:text-foreground hover:underline">
                  {CAMPING.telefono}
                </a>
              </p>
            )}
          </Columna>
        )}

        {redes && (
          <Columna titulo="Redes" icono={Share2}>
            {CAMPING.instagram && (
              <p>
                <a href={CAMPING.instagram} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
                  Instagram
                </a>
              </p>
            )}
            {CAMPING.facebook && (
              <p>
                <a href={CAMPING.facebook} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
                  Facebook
                </a>
              </p>
            )}
          </Columna>
        )}

        {CAMPING.horarios.length > 0 && (
          <Columna titulo="Horario" icono={Clock}>
            {CAMPING.horarios.map((franja) => (
              <p key={franja}>{franja}</p>
            ))}
          </Columna>
        )}

        {CAMPING.direccion && (
          <Columna titulo="Dirección" icono={MapPin}>
            <p>{CAMPING.direccion}</p>
          </Columna>
        )}
      </div>

      <div className="border-t border-tierra-200">
        <div className="container mx-auto flex flex-col items-center justify-between gap-3 px-4 py-5 text-sm text-muted-foreground sm:flex-row">
          <p>&copy; {new Date().getFullYear()} {CAMPING.nombre}. Todos los derechos reservados.</p>
          {/* Exigido por la Disposición 954/2025: visible en todas las pantallas y sin iniciar sesión */}
          <Link
            to="/arrepentimiento"
            className="rounded-full border border-tierra-300 px-4 py-2 font-medium text-foreground hover:bg-tierra-100"
          >
            Botón de arrepentimiento
          </Link>
        </div>
      </div>
    </footer>
  );
}
