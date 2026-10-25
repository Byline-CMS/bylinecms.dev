import { bylineLayerOrder } from '@byline/ui/css-layers'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Manual browser fixture: no database, routes or CMS bootstrap.
export default defineConfig({
  publicDir: false,
  css: { postcss: { plugins: [bylineLayerOrder()] } },
  plugins: [tailwindcss(), react()],
  build: {
    outDir: 'node_modules/.cache/css-layers',
    rolldownOptions: { input: 'tests/css-layers/index.html' },
  },
  preview: { host: '127.0.0.1', port: 5574, strictPort: true },
})
