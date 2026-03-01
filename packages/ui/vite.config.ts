/**
 * We're using vite for storybook and testing, although
 * we could switch to rslib/rsbuild's storybook plugin
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
})
