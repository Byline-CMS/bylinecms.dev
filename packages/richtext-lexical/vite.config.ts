/**
 * Vite config for vitest. The Rslib build runs separately via rslib.config.ts.
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
})
