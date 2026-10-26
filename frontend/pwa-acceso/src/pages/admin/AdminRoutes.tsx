import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { RutaProtegida } from '@/components/auth/RutaProtegida';
import { adminRoutes } from './routes';

/** Árbol de rutas de /admin/*: protegido para ADMIN y envuelto en el layout común. */
export default function AdminRoutes() {
  return (
    <Routes>
      <Route element={<RutaProtegida roles={['ADMIN']} />}>
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