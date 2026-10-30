// URL base del backend (se puede sobreescribir con VITE_API_URL en el .env del frontend)
const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

export type MotivoSocio = 'NO_EXISTE' | 'NO_ES_SOCIO' | 'CUOTA_VENCIDA';

// Lo que responde GET /socios/validar/{dni}. Nombre y condición solo vienen si el socio es válido.
export interface ValidacionSocio {
  valido: boolean;
  motivo: MotivoSocio | null;
  nombre: string | null;
  condicion: 'socio' | null;
}

export async function validarSocio(dni: string, signal?: AbortSignal): Promise<ValidacionSocio> {
  const respuesta = await fetch(`${API_URL}/socios/validar/${encodeURIComponent(dni.trim())}`, {
    signal,
  });
  if (!respuesta.ok) {
    throw new Error('No se pudo verificar el DNI.');
  }
  return (await respuesta.json()) as ValidacionSocio;
}

// Texto para mostrar bajo el campo de DNI cuando el backend rechaza al socio
export function mensajeMotivoSocio(motivo: MotivoSocio | null): string {
  switch (motivo) {
    case 'NO_EXISTE':
      return 'No encontramos ningún socio con ese DNI. Revisalo o elegí "Visitante General".';
    case 'NO_ES_SOCIO':
      return 'Ese DNI no pertenece a un socio. Elegí "Visitante General" para reservar.';
    case 'CUOTA_VENCIDA':
      return 'La cuota de este socio está vencida. Regularizala o elegí "Visitante General" para reservar.';
    default:
      return 'No pudimos validar el DNI. Intentá nuevamente.';
  }
}