import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND = process.env.IMPERIAL_BACKEND ?? 'http://127.0.0.1:8742'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      '/api': BACKEND,
      '/ws': { target: BACKEND.replace('http', 'ws'), ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any)
