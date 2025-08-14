import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/client',
  build: {
    outDir: '../../web/client',
    emptyOutDir: true,
    rollupOptions: {
      external: []
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0'
  },
  optimizeDeps: {
    exclude: ['xash3d-fwgs', 'cs16-client']
  }
})