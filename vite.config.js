import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['risingcreek-ai.taild0b4c6.ts.net', 'risingcreek-ai'],
    host: true,
    // The dashboard is ALWAYS already running on :5173 on the VPS (start.sh, tailscale
    // serve :8080 -> localhost:5173). Without strictPort a second `vite` silently moved
    // to 5174, 5175, ... and nothing ever stopped it — 48 stale instances / ~1.2 GB RAM
    // were found on 2026-08-16. Fail loudly instead. See README "Already running?".
    strictPort: true,
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
