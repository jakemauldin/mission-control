import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['risingcreek-ai.taild0b4c6.ts.net', 'risingcreek-ai'],
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3080',
        ws: true,
      },
    },
  },
})
