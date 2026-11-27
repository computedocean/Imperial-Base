import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BACKEND = process.env.IMPERIAL_BACKEND ?? 'http://127.0.0.1:8742'
const BASE_DIR = process.env.IMPERIAL_BASE_DIR ?? join(homedir(), '.imperial-base')

// The backend accepts a request whose Host names a dev-server port (5273/5274) only with this token, which this
// Vite process creates at start-up, writes to <base dir>/dev-proxy/vite-<port>.token and adds to every request it
// proxies. Another program on the same port does not know it; with no dev server running there is no token file.
// The browser's own Host and Origin are passed through unchanged (the proxy does not rewrite them), and the backend
// checks them.
const TOKEN = randomBytes(32).toString('hex')
const TOKEN_HEADER = 'x-imperial-dev-proxy'

function writeExclusive(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' })
  renameSync(tmp, file)
}

function removeIfOurs(file: string, text: string) {
  try {
    if (readFileSync(file, 'utf8') === text) rmSync(file)
  } catch { /* already gone */ }
}

/** Dev server only: publish the proxy token and a process record (for scripts/stop.ps1); remove both on exit. */
function imperialDevServer(): Plugin {
  return {
    name: 'imperial-dev-server',
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITEST) return // the test runner starts a Vite server too; it proxies nothing
      const port = server.config.server.port ?? 5273
      const tokenDir = join(BASE_DIR, 'dev-proxy')
      const runDir = join(BASE_DIR, 'run')
      mkdirSync(tokenDir, { recursive: true, mode: 0o700 })
      mkdirSync(runDir, { recursive: true, mode: 0o700 })
      const tokenFile = join(tokenDir, `vite-${port}.token`)
      const record = JSON.stringify({ kind: 'vite', pid: process.pid, started: (Date.now() - process.uptime() * 1000) / 1000, port })
      const recordFile = join(runDir, `vite-${process.pid}.json`)
      writeExclusive(tokenFile, TOKEN)
      writeExclusive(recordFile, record)
      const cleanup = () => { removeIfOurs(tokenFile, TOKEN); removeIfOurs(recordFile, record) }
      server.httpServer?.once('close', cleanup)
      process.once('exit', cleanup)
    },
  }
}

export default defineConfig({
  plugins: [react(), imperialDevServer()],
  server: {
    port: 5273,
    strictPort: true, // the token file is named after the port; never drift to another one
    proxy: {
      '/api': { target: BACKEND, headers: { [TOKEN_HEADER]: TOKEN } },
      '/ws': { target: BACKEND.replace('http', 'ws'), ws: true, headers: { [TOKEN_HEADER]: TOKEN } },
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any)
