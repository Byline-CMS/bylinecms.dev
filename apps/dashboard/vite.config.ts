import { tanstackRouter } from '@tanstack/router-plugin/vite'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      '@': '/src',
      '~': '/byline',
    },
  },
  build: {
    rollupOptions: {
      input: 'index.html',
    },
  },
  // build: {
  //   rollupOptions: {
  //     input: {
  //       main: 'src/main.tsx',
  //     },
  //   },
  // },
})
