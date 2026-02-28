import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'demo'),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer')
    }
  },
  plugins: [react()],
  server: {
    port: 5174,
    host: '127.0.0.1',
    open: false
  }
})
