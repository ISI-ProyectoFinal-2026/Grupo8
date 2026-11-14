import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { RutaProtegida } from '@/components/auth/RutaProtegida';
import { useManifest } from '@/hooks/useManifest';
import { LOGIN_POR_ROL } from '@/lib/auth';
import LoginAdmin from './LoginAdmin';
import { adminRoutes } from './routes';

/** Manifest propio del panel, para instalarlo como una app aparte de la del guardia. */
const MANIFEST_ADMIN = '/manifest-admin.webmanifest';

/**
 * Árbol de rutas de /admin/*: el login del panel queda abierto y el resto está protegido
 * para ADMIN y envuelto en el layout común. Todo el panel usa su propio manifest.
 */
export default function AdminRoutes() {
  useManifest(MANIFEST_ADMIN);

  return (
    <Routes>
      <Route path="login" element={<LoginAdmin />} />
      <Route element={<RutaProtegida roles={['ADMIN']} rutaLogin={LOGIN_POR_ROL.ADMIN} />}>
        <Route element={<AdminLayout />}>
          {adminRoutes.map(({ path, element }) =>
            path === '' ? (
              <Route key="inicio" index element={element} />
            ) : (
              <Route key={path} path={path} element={element} />
            )
          )}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
