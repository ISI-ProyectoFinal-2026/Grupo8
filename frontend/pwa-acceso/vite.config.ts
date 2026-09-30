import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', 
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'], 
      manifest: {
        name: 'SGIC - Control de Accesos',
        short_name: 'SGIC Accesos',
        description: 'Aplicación Offline-First para validación de ingresos al camping',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone', 
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true, 
    port: 5173,
    allowedHosts: [
      '.carnival-front-unwed.ngrok-free.dev',
      'all'
    ]
  },
  preview: {
    allowedHosts: ['.carnival-front-unwed.ngrok-free.dev', 'all'] 
  }
});