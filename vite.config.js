import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 2026,
    strictPort: true,
  },
  preview: {
    port: 2026,
    strictPort: true,
  },
  build: {
    outDir: '../dist',
  }
})
