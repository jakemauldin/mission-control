// The Brief: tier-first action queue (DESIGN.md §2).
//
// Ranking is TIER FIRST, then oldest first inside a tier — never a blended score.
// A two-day-old backup failure must always outrank a twenty-minute-old media item;
// a single numeric score cannot guarantee that, so we refuse to compute one.
//
// Snooze, not decay: nothing auto-sinks from being ignored (a decay function would
// hide exactly the items Jake keeps dodging, which are the expensive ones). Snoozes
// live in server/data/brief-state.json keyed source:id; a snoozed tier-1/2 item that
// comes back shows its snooze count rather than sinking.

import { readFileSync, readdirSync, writeFileSync, renameSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import process from "process";
import { execDocker } from "./docker.js";
import { systemsOutcomes } from "./systems.js";
import { loadStore, parseInflight } from "./projects.js";

const HOME = homedir();
const JOBS_DIR = join(HOME, "services", "rising-creek", "jobs");
const MEDIA_STATE = join("/mnt/rc_media/media-library/rising-creek");
const LOGS = join(HOME, "services", "logs");
const STATE_FILE = join(import.meta.dirname, "..", "data", "brief-state.json");

// ── snooze store ─────────────────────────────────────────────
function loadState() {
  try { const st = JSON.parse(readFileSync(STATE_FILE, "utf-8")); return { ...st, snoozes: st.snoozes || {} }; } catch { return { snoozes: {} }; }
}
function saveState(st) {
  const tmp = STATE_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(st, null, 2));
  renameSync(tmp, STATE_FILE); // same atomic pattern as lib/projects.js
}
export function snoozeItem(key, untilIso) {
  const st = loadState();
  const cur = st.snoozes[key] || { count: 0 };
  st.snoozes[key] = { until: untilIso, count: cur.count + 1 };
  saveState(st);
  invalidateBrief(); // the row must vanish on the very next fetch, not after the 60s memo
  return st.snoozes[key];
}
export function unsnoozeItem(key) {
  const st = loadState();
  if (key === "*") st.snoozes = {};
  else delete st.snoozes[key]; // dropping the entry also drops the "snoozed Nx" counter; fine for a manual undo
  saveState(st);
  invalidateBrief();
}
// Snoozed rows still active right now, for the "N snoozed" list. Titles come from the
// last build so the list reads like the queue did; a key that no longer exists is skipped.
export async function listSnoozed() {
  const st = loadState(), now = Date.now();
  const { raw } = await build();
  const byKey = new Map(raw.map(r => [r.key, r]));
  return Object.entries(st.snoozes)
    .filter(([, s]) => Date.parse(s.until) > now)
    .map(([key, s]) => ({ key, until: s.until, count: s.count, title: byKey.get(key)?.title || key, tier: byKey.get(key)?.tier || null }))
    .filter(s => byKey.has(s.key));
}

const DAY = 86400000;
// Every external source gets a hard timeout and fails soft into a chip.
const SRC_TIMEOUT = 4000;
async function getJson(url, ms = SRC_TIMEOUT, init) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const VOICE_DUMP = () => process.env.VOICE_DUMP_URL || "http://127.0.0.1:3240";
const INTEGRATION = () => process.env.INTEGRATION_API_URL || "http://172.18.0.7:3090";
const BILLS_TRACKER = () => process.env.BILLS_TRACKER_URL || "http://100.92.25.23:3230";
const ASKJAKE_PENDING = () => join(process.env.ASKJAKE_DECISIONS_DIR || join(HOME, "services", "jake-decisions"), ".pending.json");

// Proxy for the Allow / Drop buttons: voice-dump owns the decision and its side effects.
export async function decideNeed(id, action) {
  if (!/^[\w-]{1,40}$/.test(String(id))) throw new Error("bad id");
  if (action !== "allow" && action !== "drop") throw new Error("action must be allow or drop");
  const r = await getJson(`${VOICE_DUMP()}/live/ceo/decide`, 8000, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }),
  });
  invalidateBrief();
  return r;
}



// ── tier sources ─────────────────────────────────────────────
// Each returns { rows, chip? }. A throwing source becomes one "X unavailable" chip.

// Tier 1: systems red. Same verdict as the Systems page (systemsOutcomes), so red here
// is red there. One row per red card, plus the overall verdict.
async function tier1Systems() {
  const s = await withTimeout(systemsOutcomes(), 8000);
  const cards = [...(s.backups || []), ...(s.disk || []), ...(s.crons || []), ...(s.containers || []), ...(s.kernel ? [s.kernel] : [])];
  const red = cards.filter(c => !c.ok);
  const rows = red.map(c => ({
    tier: 1, key: `sys:${c.kind || "x"}:${c.name}`, title: `${c.name}${c.detail ? `: ${c.detail}` : ""}`,
    age: c.ageHours ? c.ageHours * 3600000 : 0, link: "/systems",
  }));
  if (s.overall === "RED") rows.unshift({ tier: 1, key: "sys:overall", title: `Systems overall is RED (${red.length} card${red.length === 1 ? "" : "s"})`, age: 0, link: "/systems" });
  return { rows, overall: s.overall, redCount: red.length };
}

// Needs-Jake items filed by the voice-dump bots, still open.
async function needsJake() {
  const j = await getJson(`${VOICE_DUMP()}/live/ceo/needs`);
  const rows = (j.open || []).map(n => ({
    tier: 2, key: `need:${n.id}`, title: n.title || n.id, detail: n.detail ? String(n.detail).slice(0, 240) : undefined,
    age: n.ts ? Math.max(0, Date.now() - Date.parse(n.ts)) : 0, link: "/", needId: n.id, kind: "need",
  }));
  return { rows };
}

// The ask-jake question currently waiting on a voice reply, if any.
function askJakePending() {
  const f = ASKJAKE_PENDING();
  if (!existsSync(f)) return { rows: [] };
  const p = JSON.parse(readFileSync(f, "utf-8"));
  const exp = Number(p.expires);
  if (exp && (exp < 1e12 ? exp * 1000 : exp) < Date.now()) return { rows: [] }; // stale file from a dead run
  const epoch = Number(p.epoch) || 0;
  return { rows: [{ tier: 2, key: `ask:${p.msg_id || epoch}`, title: `Question waiting on you: ${String(p.question || "").slice(0, 200)}`, age: epoch ? Date.now() - epoch * 1000 : 0, link: "/", kind: "ask" }] };
}

// RFIs from every job dir with an rfi.json. Blocking ones are individual tier 2 rows;
// non-blocking ones collapse to ONE tier 4 row per job.
function rfiTiers() {
  const t2 = [], t4 = [];
  let dirs = [];
  try { dirs = readdirSync(JOBS_DIR); } catch { return { t2, t4, blocking: 0 }; }
  for (const d of dirs) {
    const f = join(JOBS_DIR, d, "rfi.json");
    if (!existsSync(f)) continue;
    try {
      const rfi = JSON.parse(readFileSync(f, "utf-8"));
      const jobId = d.split("-")[0];
      const mtime = statSync(f).mtimeMs;
      let open = 0, oldest = 0;
      for (const g of rfi.groups || []) {
        for (const it of g.items || []) {
          // raised is often missing; fall back to the file's mtime so every row shows an age
          const age = Math.max(0, Date.now() - (it.raised ? Date.parse(it.raised) || mtime : mtime));
          if (it.status === "blocking") {
            t2.push({ tier: 2, key: `rfi:${jobId}:${it.id}`, title: `RFI ${it.id} ${it.title} (#${jobId})`, age, link: `/rfis/${jobId}#item-${it.id}`, kind: "rfi" });
          } else if (it.status === "before_submittal") { open++; oldest = Math.max(oldest, age); }
        }
      }
      if (open) t4.push({ tier: 4, key: `rfis:${jobId}`, title: `${open} open RFI${open === 1 ? "" : "s"} on #${jobId}, oldest ${Math.floor(oldest / DAY)} days`, age: oldest, link: `/rfis/${jobId}` });
    } catch { /* malformed rfi.json: skip, never fabricate */ }
  }
  return { t2, t4 };
}

// Tier 3: money. Personal bills due soon or just past due, one batched AP row, draft pay apps.
async function billsDue() {
  const all = await getJson(`${BILLS_TRACKER()}/api/bills`);
  const rows = []; let stale = 0;
  for (const b of Array.isArray(all) ? all : []) {
    if (b.status && b.status !== "active") continue;
    if (b.paid_this_cycle) continue;
    const d = b.days_until;
    if (typeof d !== "number") continue;
    // days_until counts from next_date, a projection that goes stale; past_due is the tracker's own
    // call from the real due date. Past rows with past_due=false are stale projections, not late bills.
    const late = b.past_due && d >= -14 && d < 0;
    if (late || (d >= 0 && d <= 3)) {
      const amt = b.amount != null ? ` $${Number(b.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "";
      const when = d < 0 ? `${-d}d past due` : d === 0 ? "due today" : `due in ${d}d`;
      rows.push({ tier: 3, key: `pbill:${b.id}`, title: `${b.name}${amt}, ${when}`, age: d < 0 ? -d * DAY : 0, sortAge: -d * DAY, link: "/money/sheet", kind: "bill" });
    } else if (d < 0) stale++;
  }
  if (stale) rows.push({ tier: 3, key: "pbills:stale", title: `${stale} bill${stale === 1 ? " has a stale due date" : "s have stale due dates"}`, age: 0, sortAge: -1, link: "/money/sheet" });
  return { rows, dueCount: rows.filter(r => r.kind === "bill").length };
}
async function apPending() {
  const j = await getJson(`${INTEGRATION()}/api/pending-bills`);
  // 71 items today, mostly 4 months old lien-release notices with no amount. Count only the fresh or priced ones.
  const live = (j.pending || []).filter(b => b.status === "pending" && ((b.detectedAt && Date.now() - Date.parse(b.detectedAt) < 30 * DAY) || b.amount));
  if (!live.length) return { rows: [] };
  const oldest = Math.max(...live.map(b => b.detectedAt ? Date.now() - Date.parse(b.detectedAt) : 0));
  return { rows: [{ tier: 3, key: "ap:pending", title: `${live.length} vendor bill${live.length === 1 ? "" : "s"} waiting for review`, age: oldest, link: "/money/bills" }] };
}
function payApps() {
  const items = [];
  try {
    const billDir = join(import.meta.dirname, "..", "data", "billing");
    if (existsSync(billDir)) {
      for (const f of readdirSync(billDir).filter(x => x.endsWith(".json"))) {
        const b = JSON.parse(readFileSync(join(billDir, f), "utf-8"));
        for (const a of b.applications || []) {
          if (a.status === "draft" || !a.finalizedAt) {
            const age = a.createdAt ? Date.now() - Date.parse(a.createdAt) : 0;
            items.push({ tier: 3, key: `payapp:${b.jobId || f}:${a.number}`, title: `Pay app #${a.number} in draft (${b.jobName || f})`, age, link: `/money/pay-apps/${b.jobId || ""}/${a.number}` });
          }
        }
      }
    }
  } catch { /* billing store absent: fine */ }
  return { rows: items };
}

// Tier 5: media awaiting a bucket decision. One batched row, never one per photo.
// Count = catalogue entries with no decision in any bucket list (DESIGN.md §2, corrected).
function tier5Media() {
  const cat = JSON.parse(readFileSync(join(MEDIA_STATE, "_catalogue.json"), "utf-8"));
  const decided = new Set();
  for (const f of ["_approved.json", "_postable.json", "_trash.json", "_records.json", "_personal.json"]) {
    try {
      const d = JSON.parse(readFileSync(join(MEDIA_STATE, f), "utf-8"));
      for (const k of Array.isArray(d) ? d : Object.keys(d)) decided.add(k);
    } catch { /* absent list = nothing decided there */ }
  }
  const undecided = Object.keys(cat).filter(k => !decided.has(k)).length;
  return { rows: undecided > 0 ? [{ tier: 5, key: "media:ungraded", title: `${undecided} photos to grade`, age: 0, link: "/media" }] : [], photos: undecided };
}

// Tier 6: only what Jake flagged. Urgent to-dos, and IN-FLIGHT headings that say they wait on him.
// No "untouched Nd" rows: the store goes weeks without edits, so idle time says nothing.
const WAIT_RE = /(waiting|waits|awaiting|wait)\s+(on|for)\s+jake|jake'?s\s+go|needs\s+jake/i;
function tier6Projects() {
  const rows = [];
  try {
    for (const p of loadStore().projects || []) {
      if (p.status && p.status !== "active") continue;
      for (const t of p.todos || []) {
        if (t.urgent && !t.done) {
          const at = Date.parse(t.updated || t.created || p.lastTouched || 0) || 0;
          rows.push({ tier: 6, key: `todo:${p.id}:${t.id}`, title: `${p.name}: ${t.text}`, age: at ? Date.now() - at : 0, link: "/projects" });
        }
      }
    }
  } catch { /* store absent: fine */ }
  try {
    for (const h of parseInflight().headings) {
      if (h.status === "done" || !WAIT_RE.test(h.title) || /JAKE'S PLATE/i.test(h.title)) continue;
      const at = h.date ? Date.parse(h.date) : 0;
      rows.push({ tier: 6, key: `wait:${h.id}`, title: h.title.replace(/^[^\w]+/, "").replace(/\s*\((\d{4}-\d{2}-\d{2})?,?\s*(waiting|waits|awaiting)[^)]*\)\s*$/i, "").slice(0, 110), age: at ? Date.now() - at : 0, link: "/projects" });
    }
  } catch { /* parse failure: fine */ }
  return { rows };
}

// Overnight digest: The Claw's brief-<date>.md, with prior-day fallback (§2 —
// verified the file is frequently absent at morning check-in; queue never depends on it).
// 2-3 complete sentences of plain text, or null so the section is omitted.
export function summarize(md) {
  const text = [];
  for (let l of md.split("\n")) {
    l = l.trim();
    if (!l || /^#/.test(l) || /^-{3,}$/.test(l) || /^[-*+]\s|^\d+[.)]\s/.test(l)) continue; // headers, rules, list items
    l = l.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]+/g, "").trim();
    if (/^(theme|wildcard)\s*:/i.test(l)) continue;
    text.push(l);
  }
  const sentences = text.join(" ").match(/[^.!?]+[.!?]+(?=\s|$)/g) || [];
  const out = []; let len = 0;
  for (const s of sentences.map(x => x.trim())) {
    if (s.length < 25) continue; // "M." style fragments
    if (len + s.length > 480 && out.length) break;
    out.push(s); len += s.length;
    if (out.length === 3) break;
  }
  return out.length ? out.join(" ") : null;
}
async function digest() {
  for (let back = 0; back < 4; back++) {
    const d = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    const r = await execDocker(`cat /home/node/.openclaw/workspace/memory/intelligence/brief-${d}.md`);
    if (r.ok && r.data?.trim()) {
      const t = summarize(r.data);
      return t ? { date: d, stale: back > 0, text: t } : null;
    }
  }
  return null; // section omitted entirely
}

// ── assembly ─────────────────────────────────────────────────
// Memo holds the UNSNOOZED build; snoozes apply on every read so snooze/unsnooze are instant.
let memo = { at: 0, data: null };
let inflight = null;
// Called by the rfi.json watcher and by snooze/decide: without this the client refetches
// and gets the same 60s-memoized result back.
export function invalidateBrief() { memo = { at: 0, data: null }; }

async function build() {
  if (memo.data && Date.now() - memo.at < 60_000) return memo.data;
  if (inflight) return inflight;
  inflight = (async () => {
    const chips = [];
    const run = async (name, fn) => {
      try { return await fn(); } catch { chips.push({ source: name, label: `${name} unavailable` }); return { rows: [] }; }
    };
    const [sys, need, bills, ap, media, dg] = await Promise.all([
      run("Systems", tier1Systems), run("Needs-Jake queue", needsJake), run("Bills", billsDue),
      run("AP bills", apPending), run("Media", async () => tier5Media()), digest().catch(() => null),
    ]);
    const ask = await run("Ask-Jake", async () => askJakePending());
    const { t2, t4 } = rfiTiers();
    const raw = [...sys.rows, ...need.rows, ...ask.rows, ...t2, ...bills.rows, ...ap.rows, ...payApps().rows, ...t4, ...media.rows, ...(await run("Projects", async () => tier6Projects())).rows];
    const data = {
      raw, chips, digest: dg,
      systems: { overall: sys.overall || null, red: sys.redCount || 0 },
      counts: { needs: need.rows.length + ask.rows.length + t2.length, blockingRfis: t2.length, billsDue: bills.dueCount || 0, photos: media.photos || 0 },
    };
    memo = { at: Date.now(), data };
    return data;
  })().finally(() => { inflight = null; });
  return inflight;
}

export async function buildBrief() {
  const b = await build();
  const st = loadState(), now = Date.now();
  let snoozed = 0;
  let rows = b.raw.map(r => {
    const sn = st.snoozes[r.key];
    if (sn && Date.parse(sn.until) > now) { snoozed++; return null; } // actively snoozed
    return sn ? { ...r, snoozedTimes: sn.count } : r;                 // returned from snooze
  }).filter(Boolean);

  // tier first, oldest first inside a tier — the whole point
  rows.sort((a, b) => a.tier - b.tier || (b.sortAge ?? b.age) - (a.sortAge ?? a.age));

  return {
    generated: new Date(memo.at || now).toISOString(), queue: rows.slice(0, 6), more: Math.max(0, rows.length - 6), all: rows,
    digest: b.digest, chips: b.chips, snoozed, systems: b.systems, counts: b.counts,
  };
}
