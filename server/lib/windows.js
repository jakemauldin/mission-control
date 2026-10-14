// Windows (Jake 2026-10-14): one page of live views into the desktops and dashboards he keeps open all day,
// Kasm 1 and 2, OpenClaw and App Builds, each one clickable on its own. The page only looks at them: closing
// it closes nothing on the other side.
//
// Each window is probed from this host (same tailnet names Jake's browser uses) for two things: is it up, and
// will a browser show it inside a frame. A window that forbids framing (X-Frame-Options, CSP frame-ancestors)
// or is plain http (a secure page can't frame it) becomes a click-through tile that opens it in its own tab.
// The probe re-reads the headers, so a service that starts allowing frames moves to a live tile on its own.
//
// Built-in windows live here. Windows Jake adds, and which ones he hid, live in server/data/windows.json
// (gitignored), so laptop and phone show the same page.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

const STORE = process.env.MC_WINDOWS_PATH || join(import.meta.dirname, "..", "data", "windows.json");
const TAILNET_HOST = process.env.TAILNET_HOST || "risingcreek-ai.taild0b4c6.ts.net";
const PROBE_MS = 4000;
const CACHE_MS = 60_000;
const MAX_CUSTOM = 24;

// KasmVNC reads these from the query string and keeps them for its origin. scale = shrink the picture to the
// tile, never resize the remote desktop (resize=remote would shrink The Claw's browser viewport to tile size).
// idle_disconnect is minutes; 0 would disconnect at once (ui.js compares idle seconds against minutes * 60).
const KASM_QUERY = "?resize=scale&reconnect=true&idle_disconnect=720";

export const BUILT_IN = [
  { id: "kasm1", title: "Kasm 1", port: 7901, path: `/${KASM_QUERY}`, kind: "vnc",
    note: "openclaw-browser, the shared Chrome with your logins. Asks for the Kasm password once per browser." },
  { id: "kasm2", title: "Kasm 2", port: 7902, path: `/${KASM_QUERY}`, kind: "vnc",
    note: "openclaw-browser-2, a copy of the same profile for a second job at once." },
  { id: "openclaw", title: "OpenClaw", port: 8443, path: "/", kind: "web",
    note: "The Claw's control UI.",
    blocked: "OpenClaw's control UI tells browsers never to show it inside another page (X-Frame-Options DENY, frame-ancestors 'none') and has no setting to allow it." },
  { id: "apps", title: "App Builds", local: "/apps", kind: "local",
    note: "Same files as the claude.ai App Builds artifact, which claude.ai won't let another site frame." },
];

function readStore() {
  try {
    if (!existsSync(STORE)) return { custom: [], hidden: [] };
    const d = JSON.parse(readFileSync(STORE, "utf-8"));
    return { custom: Array.isArray(d.custom) ? d.custom : [], hidden: Array.isArray(d.hidden) ? d.hidden : [] };
  } catch {
    return { custom: [], hidden: [] };
  }
}

function writeStore(d) {
  mkdirSync(dirname(STORE), { recursive: true });
  const tmp = `${STORE}.tmp`;
  writeFileSync(tmp, JSON.stringify(d, null, 2));
  renameSync(tmp, STORE);
}

// The address this host probes. Jake's browser builds its own from the hostname it reached Mission Control on.
function probeUrl(w) {
  if (w.local) return null;
  if (w.port) return `https://${TAILNET_HOST}:${w.port}${w.path || "/"}`;
  return w.url;
}

// Would a browser show `headers` inside a frame on another origin? -> reason string when not, else null.
export function frameBlock(headers, url) {
  if (url && url.startsWith("http:")) return "It is plain http, and a secure page can't show plain http inside a frame.";
  const xfo = (headers.get("x-frame-options") || "").trim().toUpperCase();
  if (xfo === "DENY" || xfo === "SAMEORIGIN") return `It tells browsers not to show it inside another site's page (X-Frame-Options ${xfo}).`;
  const csp = headers.get("content-security-policy") || "";
  const fa = csp.split(";").map((s) => s.trim()).find((s) => s.toLowerCase().startsWith("frame-ancestors"));
  if (fa) {
    const srcs = fa.split(/\s+/).slice(1);
    const ok = srcs.some((s) => s === "*" || s === "https:" || s.includes(TAILNET_HOST) || s.includes(".ts.net"));
    if (!ok) return `It only lets ${srcs.join(" ") || "nothing"} frame it (CSP frame-ancestors).`;
  }
  return null;
}

async function probe(w) {
  if (w.local) return { up: true, frameable: true, status: 200, ms: 0 };
  const url = probeUrl(w);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(PROBE_MS) });
    r.body?.cancel?.().catch(() => {});
    const blocked = frameBlock(r.headers, url);
    return {
      up: r.status < 500,
      status: r.status,
      ms: Date.now() - t0,
      signIn: r.status === 401,
      frameable: !blocked,
      reason: blocked ? (w.blocked || blocked) : null,
    };
  } catch (e) {
    const timedOut = e.name === "TimeoutError" || e.name === "AbortError";
    return { up: false, status: null, ms: Date.now() - t0, frameable: false,
      reason: timedOut ? `No answer in ${PROBE_MS / 1000} s.` : `Unreachable (${e.cause?.code || e.message}).` };
  }
}

let cache = { at: 0, byId: {} };
let inflight = null;

async function probeAll(list, force) {
  if (!force && Date.now() - cache.at < CACHE_MS && list.every((w) => cache.byId[w.id])) return cache;
  if (inflight) return inflight;
  inflight = Promise.all(list.map(async (w) => [w.id, await probe(w)]))
    .then((pairs) => { cache = { at: Date.now(), byId: Object.fromEntries(pairs) }; return cache; })
    .finally(() => { inflight = null; });
  return inflight;
}

export async function listWindows({ fresh = false } = {}) {
  const store = readStore();
  const all = [...BUILT_IN.map((w) => ({ ...w, builtIn: true })), ...store.custom.map((w) => ({ ...w, builtIn: false }))];
  const c = await probeAll(all, fresh);
  return {
    checkedAt: new Date(c.at).toISOString(),
    host: TAILNET_HOST,
    windows: all.map((w) => ({ ...w, hidden: store.hidden.includes(w.id), check: c.byId[w.id] || null })),
  };
}

export function addWindow({ title, url, note }) {
  const t = String(title || "").trim().slice(0, 60);
  const u = String(url || "").trim();
  if (!t) return { ok: false, error: "give it a name" };
  let parsed;
  try { parsed = new URL(u); } catch { return { ok: false, error: "that address is not a full http(s) link" }; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, error: "only http and https links" };
  const store = readStore();
  if (store.custom.length >= MAX_CUSTOM) return { ok: false, error: `${MAX_CUSTOM} windows is the limit` };
  const w = { id: `w-${randomUUID().slice(0, 8)}`, title: t, url: parsed.href, note: String(note || "").trim().slice(0, 200), kind: "web" };
  store.custom.push(w);
  writeStore(store);
  cache.at = 0;
  return { ok: true, data: w };
}

export function setHidden(id, hidden) {
  const store = readStore();
  const known = BUILT_IN.some((w) => w.id === id) || store.custom.some((w) => w.id === id);
  if (!known) return { ok: false, error: "no window with that id" };
  store.hidden = store.hidden.filter((x) => x !== id);
  if (hidden) store.hidden.push(id);
  writeStore(store);
  return { ok: true };
}

export function removeWindow(id) {
  const store = readStore();
  if (BUILT_IN.some((w) => w.id === id)) return { ok: false, error: "built-in windows can be hidden, not removed" };
  const n = store.custom.length;
  store.custom = store.custom.filter((w) => w.id !== id);
  if (store.custom.length === n) return { ok: false, error: "no window with that id" };
  store.hidden = store.hidden.filter((x) => x !== id);
  writeStore(store);
  return { ok: true };
}
