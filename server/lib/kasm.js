// Kasm shared browser (2026-08-23): tab control for the Chrome running in the
// `openclaw-browser` container, via its DevTools HTTP endpoint. That Chrome holds Jake's
// live third-party logins — we never touch the container itself here (no restart, ever;
// see .claude/rules/self-restart.md upstream) and we guard the failure mode that has
// already OOM'd the VPS once: opening a URL activates an existing same-origin tab instead
// of piling on a new one. The CDP endpoint has wedged before (a Page.navigate hung 45s), so
// every call here carries its own AbortController timeout and degrades to {ok:false,
// message} — it must never hang the API.
const CDP_BASE = process.env.KASM_CDP_URL || "http://172.18.0.3:9224";
const TIMEOUT_MS = 5000;

async function cdpFetch(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${CDP_BASE}${path}`, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!r.ok) {
      const detail = typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200);
      return { ok: false, message: `shared browser said ${r.status}: ${detail}` };
    }
    return { ok: true, data };
  } catch (e) {
    const timedOut = e.name === "AbortError";
    return { ok: false, message: timedOut ? "shared browser not responding (5s timeout)" : `shared browser unreachable: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

export function isHttpUrl(u) {
  if (typeof u !== "string" || !u) return false;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

function toTab(t) {
  let hostname = "";
  try { hostname = new URL(t.url).hostname; } catch { /* about:blank, chrome://, etc. */ }
  return { id: t.id, title: t.title || t.url || "(untitled)", url: t.url, hostname };
}

// Real, user-visible tabs only — CDP /json also lists background pages, service workers,
// and other internal targets that would just be noise here.
async function listTargets() {
  const r = await cdpFetch("/json");
  if (!r.ok) return r;
  return { ok: true, data: Array.isArray(r.data) ? r.data : [] };
}

export async function listTabs() {
  const r = await listTargets();
  if (!r.ok) return r;
  return { ok: true, data: r.data.filter((t) => t.type === "page").map(toTab) };
}

async function rawActivate(id) {
  const r = await cdpFetch(`/json/activate/${encodeURIComponent(id)}`);
  if (!r.ok) return r;
  return { ok: true, data: { id, activated: true } };
}

async function rawClose(id) {
  const r = await cdpFetch(`/json/close/${encodeURIComponent(id)}`);
  if (!r.ok) return r;
  return { ok: true, data: { id, closed: true } };
}

// Opening a URL activates an existing same-origin tab instead of creating a new one —
// the leaked-tab OOM guard (2026-08-23 notes: leaked tabs have OOM-killed the VPS).
export async function openUrl(url) {
  if (!isHttpUrl(url)) return { ok: false, message: "url must be http:// or https://" };
  const targetOrigin = new URL(url).origin;
  const list = await listTargets();
  if (!list.ok) return list;
  const pages = list.data.filter((t) => t.type === "page");
  const existing = pages.find((t) => { try { return new URL(t.url).origin === targetOrigin; } catch { return false; } });
  if (existing) {
    const r = await rawActivate(existing.id);
    if (!r.ok) return r;
    return { ok: true, data: { id: existing.id, activated: true, created: false }, message: `Activated existing tab: ${existing.title || existing.url}` };
  }
  const r = await cdpFetch(`/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!r.ok) return r;
  const created = r.data && typeof r.data === "object" ? r.data : {};
  return { ok: true, data: { id: created.id || null, activated: false, created: true }, message: `Opened new tab: ${url}` };
}

// id is validated against a fresh /json listing before use — never forwarded to the CDP
// endpoint unchecked, and it gives a clean "tab not found" instead of a raw CDP error string.
export async function activate(id) {
  const list = await listTargets();
  if (!list.ok) return list;
  if (!list.data.some((t) => t.id === id)) return { ok: false, notFound: true, message: "tab not found (already closed?)" };
  return rawActivate(id);
}

export async function close(id) {
  const list = await listTargets();
  if (!list.ok) return list;
  if (!list.data.some((t) => t.id === id)) return { ok: false, notFound: true, message: "tab not found (already closed?)" };
  return rawClose(id);
}
