import { useEffect } from 'react';
import { dbService } from './services/dbService';

function App() {
  
  useEffect(() => {
    // Prueba de escritura rápida para verificar persistencia
    const inicializarDB = async () => {
      try {
        await dbService.guardarConfiguracion('version_app', '1.0.0');
        console.log('✅ IndexedDB inicializada y configurada correctamente');
      } catch (error) {
        console.error('❌ Error al inicializar IndexedDB:', error);
      }
    };
    
    inicializarDB();
  }, []);

  return (
    <div>
      <h1>Sistema de Acceso - Grupo 8</h1>
    </div>
  )
}

export default App;