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
import { execDocker } from "./docker.js";

const HOME = homedir();
const JOBS_DIR = join(HOME, "services", "rising-creek", "jobs");
const MEDIA_STATE = join("/mnt/rc_media/media-library/rising-creek");
const LOGS = join(HOME, "services", "logs");
const STATE_FILE = join(import.meta.dirname, "..", "data", "brief-state.json");

// ── snooze store ─────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")); } catch { return { snoozes: {} }; }
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
  return st.snoozes[key];
}

// ── tier sources ─────────────────────────────────────────────

// Tier 1: systems red — expected artifacts stale/0-byte, disk critical.
// Reads the same logs the health check asserts; no docker calls on this path.
function tier1Systems() {
  const items = [];
  const now = Date.now();
  const checks = [
    { name: "openclaw-volume backup", path: "/var/log/openclaw-backup.log", pat: /Upload successful/, maxH: 48 },
    { name: "services-host backup", path: join(LOGS, "services-backup.log"), pat: /Backup Complete/, maxH: 48 },
    { name: "media mirror", path: join(LOGS, "media-mirror.log"), pat: /Media mirror complete/, maxH: 192 },
  ];
  for (const c of checks) {
    try {
      // live file only here; the nightly health check does the deep .gz search.
      // A fresh success line in the live file clears the row; absence + old mtime flags it.
      const txt = existsSync(c.path) ? readFileSync(c.path, "utf-8") : "";
      const ok = c.pat.test(txt);
      const ageH = existsSync(c.path) ? (now - statSync(c.path).mtimeMs) / 3600000 : Infinity;
      if (!ok && ageH > c.maxH) {
        items.push({ tier: 1, key: `sys:${c.name}`, title: `${c.name} — no success in ${Math.round(ageH)}h`, age: ageH * 3600000, link: "/systems" });
      }
    } catch { /* unreadable = not provable red from here; Systems page handles it */ }
  }
  if (!isMounted("/mnt/rc_media")) {
    items.push({ tier: 1, key: "sys:rc-media-mount", title: "rc-media volume NOT MOUNTED — media primary offline", age: 0, link: "/systems" });
  }
  return items;
}
function isMounted(p) {
  try { return readFileSync("/proc/mounts", "utf-8").split("\n").some(l => l.split(" ")[1] === p); } catch { return true; }
}

// Tiers 2 + 4: RFIs from every job dir with an rfi.json.
function rfiTiers() {
  const t2 = [], t4 = [];
  let dirs = [];
  try { dirs = readdirSync(JOBS_DIR); } catch { return { t2, t4 }; }
  for (const d of dirs) {
    const f = join(JOBS_DIR, d, "rfi.json");
    if (!existsSync(f)) continue;
    try {
      const rfi = JSON.parse(readFileSync(f, "utf-8"));
      const jobId = d.split("-")[0];
      for (const g of rfi.groups || []) {
        for (const it of g.items || []) {
          const age = it.raised ? Date.now() - Date.parse(it.raised) : 0;
          const row = { key: `rfi:${jobId}:${it.id}`, title: `RFI ${it.id} ${it.title} (${rfi.job || d})`, age, link: `/rfis/${jobId}#item-${it.id}` };
          if (it.status === "blocking") t2.push({ tier: 2, ...row });
          else if (it.status === "before_submittal") t4.push({ tier: 4, ...row });
        }
      }
    } catch { /* malformed rfi.json — skip, never fabricate */ }
  }
  return { t2, t4 };
}

// Tier 3: money needing a decision — draft pay apps + bills due soon (proxied AP).
async function tier3Money() {
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
  } catch { /* billing store absent — fine */ }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch((process.env.INTEGRATION_API_URL || "http://172.18.0.7:3090") + "/api/pending-bills", { signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) {
      const bills = (await r.json())?.data || [];
      for (const b of Array.isArray(bills) ? bills : []) {
        items.push({ tier: 3, key: `bill:${b.id}`, title: `Bill pending: ${b.vendor || b.name || b.id}`, age: b.createdAt ? Date.now() - Date.parse(b.createdAt) : 0, link: "/money/bills" });
      }
    }
  } catch { items.push({ tier: 3, key: "bills:unreachable", chip: true, title: "bills unavailable", age: 0, link: "/money/bills" }); }
  return items;
}

// Tier 5: media awaiting a bucket decision. One batched row, never one per photo.
// Count = catalogue entries with no decision in any bucket list (DESIGN.md §2, corrected).
function tier5Media() {
  try {
    const cat = JSON.parse(readFileSync(join(MEDIA_STATE, "_catalogue.json"), "utf-8"));
    const decided = new Set();
    for (const f of ["_approved.json", "_postable.json", "_trash.json", "_records.json", "_personal.json"]) {
      try {
        const d = JSON.parse(readFileSync(join(MEDIA_STATE, f), "utf-8"));
        for (const k of Array.isArray(d) ? d : Object.keys(d)) decided.add(k);
      } catch { /* absent list = nothing decided there */ }
    }
    const undecided = Object.keys(cat).filter(k => !decided.has(k)).length;
    if (undecided > 0) {
      return [{ tier: 5, key: "media:ungraded", title: `${undecided} photos awaiting your call`, age: 0, link: "/media" }];
    }
  } catch { /* media state unreadable — Systems will say so */ }
  return [];
}

// Tier 6: project drift — urgent todos or active projects untouched > 5 days.
function tier6Projects() {
  const items = [];
  try {
    const pj = JSON.parse(readFileSync(join(HOME, "services", "projects", "projects.json"), "utf-8"));
    const projects = pj.projects || pj || [];
    for (const p of Array.isArray(projects) ? projects : []) {
      if (p.status && p.status !== "active") continue;
      const touched = Date.parse(p.lastTouched || p.updated || 0) || 0;
      const idleDays = (Date.now() - touched) / 86400000;
      const urgent = (p.todos || []).some(t => t.urgent && !t.done);
      if (urgent || (touched && idleDays > 5)) {
        items.push({ tier: 6, key: `proj:${p.id || p.name}`, title: urgent ? `Urgent todo on ${p.name}` : `${p.name} untouched ${Math.floor(idleDays)}d`, age: Date.now() - touched, link: "/projects" });
      }
    }
  } catch { /* absent — fine */ }
  return items;
}

// Overnight digest: The Claw's brief-<date>.md, with prior-day fallback (§2 —
// verified the file is frequently absent at morning check-in; queue never depends on it).
async function digest() {
  for (let back = 0; back < 4; back++) {
    const d = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    const r = await execDocker(`cat /home/node/.openclaw/workspace/memory/intelligence/brief-${d}.md`);
    if (r.ok && r.data?.trim()) {
      // 2-3 lines, not a wall (§2): skip markdown headers, take the first 3 content lines
      const lines = r.data.split("\n").filter(l => l.trim() && !l.trim().startsWith("#") && l.trim() !== "---");
      return { date: d, stale: back > 0, text: lines.slice(0, 3).join("\n") };
    }
  }
  return null; // section omitted entirely
}

// ── assembly ─────────────────────────────────────────────────
let memo = { at: 0, data: null };
// Called by the rfi.json watcher: without this the ws push tells the client to
// refetch and the client gets the same 60s-memoized queue back.
export function invalidateBrief() { memo = { at: 0, data: null }; }

export async function buildBrief() {
  if (memo.data && Date.now() - memo.at < 60_000) return memo.data; // 60s TTL (§2)
  const st = loadState();
  const { t2, t4 } = rfiTiers();
  const [t3, dg] = await Promise.all([tier3Money(), digest()]);
  let rows = [...tier1Systems(), ...t2, ...t3, ...t4, ...tier5Media(), ...tier6Projects()];

  const now = Date.now();
  rows = rows.map(r => {
    const sn = st.snoozes[r.key];
    if (sn && Date.parse(sn.until) > now) return null;            // actively snoozed
    if (sn) r.snoozedTimes = sn.count;                            // returned from snooze
    return r;
  }).filter(Boolean);

  // tier first, oldest first inside a tier — the whole point
  rows.sort((a, b) => a.tier - b.tier || b.age - a.age);

  const data = { generated: new Date().toISOString(), queue: rows.slice(0, 6), more: Math.max(0, rows.length - 6), all: rows, digest: dg };
  memo = { at: Date.now(), data };
  return data;
}
