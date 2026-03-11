import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',   // don't auto-reinstall silently — let skipWaiting do it
      injectRegister: 'auto',
      workbox: {
        skipWaiting: true,       // new SW takes over immediately on install
        clientsClaim: true,      // immediately claim all open tabs
        // Don't cache HTML — always fetch fresh so new SW is detected
        navigateFallback: null,
        runtimeCaching: [],
      },
      manifest: false,           // use our own public/manifest.json
    }),
  ],
})
