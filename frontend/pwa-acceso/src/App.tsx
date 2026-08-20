import { useState } from 'react';
import { addToBlacklist, isIdBlacklisted } from './services/database';

function App() {
  // Guardamos en la memoria de la pantalla lo que el usuario escribe y el mensaje de alerta
  const [inputId, setInputId] = useState('');
  const [mensaje, setMensaje] = useState('');

  // Esta función usa tu "Lapicera"
  const handleBloquear = async () => {
    if (!inputId) return;
    await addToBlacklist(inputId);
    setMensaje(`ID ${inputId} agregado a la libreta negra 🚫`);
    setInputId(''); // Limpiamos el input
  };

  // Esta función usa tu "Lupa" y cumple el DoD exacto de tu Issue
  const handleValidar = async () => {
    if (!inputId) return;
    
    // Le preguntamos a tu base de datos si el ID está bloqueado
    const estaBloqueado = await isIdBlacklisted(inputId);
    
    if (estaBloqueado) {
      // Si está en la libreta negra, mostramos el mensaje exacto que pide el criterio de aceptación
      setMensaje("⚠️ Reserva Cancelada / Acceso Revocado");
    } else {
      setMensaje("✅ Acceso Permitido");
    }
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'sans-serif' }}>
      <h1>Sistema de Acceso - Grupo 8</h1>
      <h2>Prototipo de Validación Offline (Issue 7.1)</h2>
      
      <div style={{ margin: '20px 0' }}>
        <input 
          type="text" 
          placeholder="Ingrese ID del visitante..." 
          value={inputId}
          onChange={(e) => setInputId(e.target.value)}
          style={{ padding: '10px', marginRight: '10px', width: '200px' }}
        />
        <button onClick={handleValidar} style={{ padding: '10px', marginRight: '10px', cursor: 'pointer' }}>
          🔍 Validar Ingreso
        </button>
        <button onClick={handleBloquear} style={{ padding: '10px', backgroundColor: '#ff4444', color: 'white', cursor: 'pointer', border: 'none', borderRadius: '4px' }}>
          🚫 Bloquear ID
        </button>
      </div>

      {/* Si hay un mensaje para mostrar, lo renderizamos en este cuadro */}
      {mensaje && (
        <div style={{ 
          padding: '15px', 
          border: '1px solid #ccc', 
          borderRadius: '5px',
          backgroundColor: mensaje.includes('Reserva Cancelada') ? '#ffebee' : '#e8f5e9',
          color: 'black'
        }}>
          <strong>{mensaje}</strong>
        </div>
      )}
    </div>
  );
}

export default App;