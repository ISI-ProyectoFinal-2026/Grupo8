import { expect, type APIRequestContext } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { URL_SERVICIOS_FALSOS } from '../entorno';
import type { CorreoFalso } from '../servicios-falsos';

/** Espera el correo de confirmación que el backend mandó (a Resend falso) y devuelve el PNG del QR. */
export async function esperarQrDelCorreo(
  request: APIRequestContext,
  email: string
): Promise<Buffer> {
  let correo: CorreoFalso | undefined;
  // El correo sale en segundo plano (BackgroundTasks) después de responder al webhook
  await expect
    .poll(
      async () => {
        const respuesta = await request.get(
          `${URL_SERVICIOS_FALSOS}/__e2e/correos`,
          { params: { para: email } }
        );
        const correos = (await respuesta.json()) as CorreoFalso[];
        correo = correos.find((c) =>
          c.attachments?.some((a) => a.filename.endsWith('.png'))
        );
        return Boolean(correo);
      },
      { message: `No llegó el correo con el QR a ${email}` }
    )
    .toBe(true);

  const adjunto = correo!.attachments!.find((a) =>
    a.filename.endsWith('.png')
  )!;
  return Buffer.from(adjunto.content);
}

/** Lee el texto del QR desde la imagen, como lo haría la cámara del guardia. */
export function leerQr(png: Buffer): string {
  const imagen = PNG.sync.read(png);
  const resultado = jsQR(
    new Uint8ClampedArray(imagen.data),
    imagen.width,
    imagen.height
  );
  if (!resultado)
    throw new Error('La imagen del correo no contiene un QR legible.');
  return resultado.data;
}
