import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // Actualiza la PWA automáticamente si hay nueva versión
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'], // Archivos estáticos
      manifest: {
        name: 'SGIC - Control de Accesos',
        short_name: 'SGIC Accesos',
        description: 'Aplicación Offline-First para validación de ingresos al camping',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone', // Esto oculta la barra de navegación del navegador (parece app nativa)
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        // Cache-First strategy para archivos de interfaz
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ],
  // AQUÍ SE AGREGA LA CONFIGURACIÓN PARA EL SERVIDOR DE PREVIEW
  preview: {
    allowedHosts: ['.carnival-front-unwed.ngrok-free.dev', 'all'] 
  }
});
