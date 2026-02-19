import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  server: {
    port: 5173,
  },
  // Bundle these packages during SSR so Vite handles their CSS module imports
  // (Node.js can't natively process .css files).
  ssr: {
    noExternal: ['@infonomic/uikit'],
  },
  plugins: [
    tsConfigPaths(),
    tanstackStart({
      // Enable SPA mode – ideal for a CMS admin dashboard.
      // Server routes and server functions still work in SPA mode.
      // Remove or set to false to enable full SSR.
      spa: { enabled: true },
    }),
    // NOTE: react() must come AFTER tanstackStart()
    react(),
    tailwindcss(),
  ],
  clearScreen: false,
})
