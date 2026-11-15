import { expect, type APIRequestContext } from '@playwright/test';
import { CREDENCIALES, URL_BACKEND } from '../entorno';
import { tokenPorApi } from './sesion';

/**
 * Fija las reglas de cancelación del camping (Issue 22.1) por la API del panel.
 *
 * Cada prueba fija el plazo que necesita en vez de depender del valor que traiga la migración:
 * así el resultado no cambia si mañana alguien modifica el valor por defecto.
 * La API exige enviar toda la configuración junta, por eso se lee y se reenvía con el cambio.
 */
export async function fijarReglasDeCancelacion(
  request: APIRequestContext,
  reglas: { dias: number; porcentaje: number }
): Promise<void> {
  const token = await tokenPorApi(request, CREDENCIALES.admin);
  const headers = { Authorization: `Bearer ${token}` };
  const url = `${URL_BACKEND}/api/v1/admin/configuracion`;

  const actual = (await (await request.get(url, { headers })).json()) as Record<
    string,
    unknown
  >;
  const respuesta = await request.put(url, {
    headers,
    data: {
      capacidad_total: actual.capacidad_total,
      porcentaje_buffer_offline: actual.porcentaje_buffer_offline,
      max_personas_por_reserva: actual.max_personas_por_reserva,
      dias_cancelacion: reglas.dias,
      porcentaje_devolucion: reglas.porcentaje,
    },
  });
  expect(respuesta.ok(), await respuesta.text()).toBeTruthy();
}
