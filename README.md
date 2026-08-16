# Rising Creek Mission Control

React + Vite UI (`src/`) with an Express API (`server/api.js`). On the VPS it runs as a
**host process** started by `~/services/start.sh`: `npm run dev` → `concurrently` →
vite dev server on **:5173** + `node --watch server/api.js` on **:3080** (vite proxies
`/api` and `/ws` to it). Reachable on the tailnet via Tailscale Serve `:8080 → localhost:5173`.
Canonical port map: `~/services/INFRASTRUCTURE.md`.

## ⚠️ Already running? Check before you `npm run dev`

The dashboard is **already up** on the VPS. Do **not** start another copy to see a change —
vite hot-reloads edits under `src/` and `node --watch` restarts the API on edits under
`server/`. Check first:

```bash
ss -tlnp | grep -E ':(5173|3080)\b'      # who holds the UI and API ports
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/
tail -20 /tmp/dashboard.log               # start.sh's log for the running instance
```

**Why this matters (2026-08-16):** for ~40 days every `start.sh` run (nightly ×2 from
`update-openclaw.sh`, plus every bridge restart) and every session that ran `npm run dev`
started *another* instance. vite silently moved to the next free port (5174, 5175, … 5220),
`node --watch` sat idle on `EADDRINUSE :3080`, and nothing reaped them: **48 vite listeners
+ 50 orphaned `npm run dev` trees, ~1.8 GB RSS**. Guards now in place:

- `start.sh` converges to one instance: both :5173 and :3080 up → untouched; one half dead (e.g. the API
  crashed under `node --watch`) → that whole tree is killed by PID-walk and restarted; neither → started.
- `vite --strictPort` (+ `server.strictPort` in `vite.config.js`): a second instance
  **exits with an error** instead of squatting a new port.
- `concurrently --kill-others-on-fail`: when vite refuses to start, the API watcher is
  torn down too, so a failed second start leaves **no** processes behind.

Need a genuinely separate UI instance (rare)? `npm run dev:client -- --port 5180` — it
still proxies `/api` to the running API on :3080 — and kill it when you're done.

To restart the real one: find the tree with `ss -tlnp | grep 5173`, `kill <pid>` the
`npm run dev` root (or the vite + api PIDs), then `cd ~/Dashboard/mission-control && npm run dev > /tmp/dashboard.log 2>&1 &`
(never `pkill -f` — it matches your own shell).

**Open question (see `~/services/TODO.md`):** production should probably be `npm run build`
+ Express serving `dist/` on one port, not a dev server with HMR and file watchers running 24/7.

---

# React + Vite (template notes)

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
