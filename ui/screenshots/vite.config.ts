import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/** The dev server of the screenshot page. It serves the real UI with a fake backend. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  mode: 'screenshots',
  plugins: [react()],
  clearScreen: false,
  server: { port: 1431, strictPort: true },
  logLevel: 'warn',
})
