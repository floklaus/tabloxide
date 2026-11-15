import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const DEV_SERVER_PORT = 1420

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri shows Rust errors in the same terminal. Do not clear them.
  clearScreen: false,
  server: {
    port: DEV_SERVER_PORT,
    // Tauri expects this port. Fail if the port is not available.
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    // Without this setting, Vitest replaces a style sheet with an empty text.
    // The colour contrast test reads the colour tokens from the style sheet.
    css: true,
  },
})
