// projects.js — per-project running to-do with progress dates (Jake, 2026-08-16:
// "the dashboard was created so I could keep a running list of to-dos … in certain
// projects … so whenever I open the project I know what I was working on or left
// undone, and me and you can update that as we progress … it doesn't get covered up
// by new sessions").
//
// Two sources, merged by slug:
//   1. AUTO — ~/services/IN-FLIGHT.md `## ` headings (status emoji + dates in the
//      heading) and the "JAKE'S PLATE" table rows (each row = a to-do with status).
//      Read-only here; sessions keep editing IN-FLIGHT.md as they always have.
//   2. MANUAL — ~/services/projects/projects.json: projects + to-dos + progress
//      notes that Jake (UI) and agents (this API or the file directly) maintain.
//      Lives in the services repo on purpose: GitOps'd, backed up, and every agent
//      can read/write it without going through the dashboard.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SERVICES = join(homedir(), "services");
const INFLIGHT = join(SERVICES, "IN-FLIGHT.md");
const STORE_DIR = join(SERVICES, "projects");
const STORE = join(STORE_DIR, "projects.json");

const EMOJI_STATUS = { "🟢": "active", "🟡": "partial", "🔴": "blocked", "⏳": "waiting", "🔵": "info", "✅": "done" };

export const slugify = (s) =>
  String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "untitled";

const nowIso = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);

// ── store ────────────────────────────────────────────────────────────────────
export function loadStore() {
  try {
    if (!existsSync(STORE)) return { version: 1, updated: null, projects: [] };
    const j = JSON.parse(readFileSync(STORE, "utf-8"));
    j.projects ||= [];
    return j;
  } catch (e) {
    return { version: 1, updated: null, projects: [], error: e.message };
  }
}
export function saveStore(store) {
  mkdirSync(STORE_DIR, { recursive: true });
  store.version = 1;
  store.updated = nowIso();
  const tmp = `${STORE}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  renameSync(tmp, STORE); // atomic — agents may read mid-write
  return store;
}

// ── IN-FLIGHT parsing ────────────────────────────────────────────────────────
// Dates seen in headings: 2026-08-16, 8/16, (8/16), "due 2026-08-12". Return the
// latest ISO-ish date string we can find, else null.
function datesIn(s) {
  const out = [];
  for (const m of s.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of s.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(new Date().getFullYear());
    out.push(`${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
  }
  return out.sort().pop() || null;
}

// A "## " heading counts as DONE if it says so right up front — "🟢 DONE …" —
// regardless of what its emoji would otherwise map to. Anchored to the start
// (after stripping the emoji) so it doesn't fire on headings that merely
// mention "done" mid-sentence (e.g. "masters DONE (2026-07-03)").
function classifyStatus(emoji, title) {
  const stripped = title.replace(/^[^\w]+/, "");
  if (/^DONE\b/i.test(stripped)) return "done";
  return emoji ? EMOJI_STATUS[emoji] : "note";
}

export function parseInflight() {
  let text = "";
  try { text = readFileSync(INFLIGHT, "utf-8"); } catch { return { headings: [], plate: null }; }
  const lines = text.split("\n");
  const rawHeadings = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^## (.*)$/);
    if (m) {
      const title = m[1].trim();
      const emoji = Object.keys(EMOJI_STATUS).find((e) => title.startsWith(e)) || null;
      cur = {
        id: slugify(title.replace(/^[^\w]+/, "").split(" — ")[0]),
        title, emoji, status: classifyStatus(emoji, title),
        date: datesIn(title), line: i + 1, body: [],
      };
      rawHeadings.push(cur);
    } else if (cur && cur.body.length < 400) cur.body.push(l);
  }
  // IN-FLIGHT.md repeats headings verbatim across sessions (same title logged
  // more than once). Dedupe by id, keeping the occurrence nearest the top of
  // the file — it's written roughly newest-first, so first-seen (smallest
  // line number, since we're walking top to bottom) wins.
  const seenIds = new Set();
  const headings = [];
  for (const h of rawHeadings) {
    if (seenIds.has(h.id)) continue;
    seenIds.add(h.id);
    headings.push(h);
  }
  // Jake's plate table (## 🔴 JAKE'S PLATE …): rows | # | **item** | status |
  const plateH = headings.find((h) => /JAKE'S PLATE/i.test(h.title));
  let plate = null;
  if (plateH) {
    const rows = [];
    for (const l of plateH.body) {
      const m = l.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
      if (!m) continue;
      const item = m[2].replace(/\*\*/g, "").trim();
      const status = m[3].trim();
      const emoji = Object.keys(EMOJI_STATUS).find((e) => status.startsWith(e)) || null;
      rows.push({ n: Number(m[1]), item, status, state: emoji ? EMOJI_STATUS[emoji] : "note", date: datesIn(status) });
    }
    plate = { id: plateH.id, title: plateH.title, date: plateH.date, rows };
  }
  return { headings, plate };
}

// IN-FLIGHT.md is a rolling changelog — most `## ` headings are one-off status
// notes (version bumps, campaign builds, ops recaps), not projects with their
// own running to-do list. Only import a heading as an auto project card when
// it both (a) carries a real status emoji and (b) names an actual JobTread
// job — Jake's own convention is "(JT #NNN)" or "(#NNN)" in the title,
// occasionally "Job NNN". Everything else stays visible in IN-FLIGHT.md (that
// file is untouched) but doesn't spawn a card, so ~83 changelog headings stop
// drowning the handful of real jobs on the Projects tab.
const PROJECT_EMOJI = new Set(["🔴", "🟡", "🟢", "✅"]);
const JOB_REF_RE = /\(\s*(?:JT\s*)?#\d+\s*\)|\bJob\s+\d{2,4}\b/i;
function looksLikeProject(h) {
  return !!h.emoji && PROJECT_EMOJI.has(h.emoji) && JOB_REF_RE.test(h.title);
}

// ── merged view ──────────────────────────────────────────────────────────────
export function getProjects() {
  const store = loadStore();
  const { headings, plate } = parseInflight();
  const bySlug = new Map(store.projects.map((p) => [p.id, p]));
  const projects = [];

  // manual projects first (they carry the to-dos), enriched with any IN-FLIGHT heading match
  for (const p of store.projects) {
    if (plate && p.id === plate.id) continue; // folded into the unshifted plate card below, not a separate card
    const h = headings.find((x) => x.id === p.id || (p.inflightMatch && x.title.includes(p.inflightMatch)));
    projects.push({
      ...p, source: "manual",
      inflight: h ? { title: h.title, status: h.status, date: h.date, line: h.line } : null,
      lastTouched: p.lastTouched || h?.date || null,
    });
  }
  // auto projects from IN-FLIGHT headings that have no manual counterpart and
  // look like a real project (see looksLikeProject above)
  let autoCount = 0;
  for (const h of headings) {
    if (bySlug.has(h.id)) continue;
    if (plate && h.id === plate.id) continue;
    if (!looksLikeProject(h)) continue;
    autoCount++;
    projects.push({
      id: h.id, name: h.title.replace(/^[^\w]+/, "").split(" — ")[0].slice(0, 90),
      status: h.status, source: "inflight", todos: [], progressNote: null,
      lastTouched: h.date, inflight: { title: h.title, status: h.status, date: h.date, line: h.line },
    });
  }
  // the plate as its own project: rows → read-only to-dos with the table's status
  if (plate) {
    const manual = bySlug.get(plate.id);
    const rowTodos = plate.rows.map((r) => ({
      id: `plate-${r.n}`, text: `${r.n}. ${r.item}`, done: r.state === "done" || r.state === "active",
      state: r.state, note: r.status, readOnly: true, updated: r.date,
    }));
    projects.unshift({
      id: plate.id, name: "Jake's plate (IN-FLIGHT table)", status: "active", source: "plate",
      todos: [...rowTodos, ...((manual && manual.todos) || [])],
      progressNote: manual?.progressNote || null, lastTouched: manual?.lastTouched || plate.date,
      inflight: { title: plate.title, date: plate.date },
    });
  }
  // sort: active work first, then by lastTouched desc
  const rank = { active: 0, partial: 1, waiting: 2, blocked: 3, note: 4, info: 5, done: 6, paused: 7 };
  projects.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || String(b.lastTouched || "").localeCompare(String(a.lastTouched || "")));
  return { updated: store.updated, projects, counts: { total: projects.length, manual: store.projects.length, inflight: autoCount } };
}

// ── mutations (all touch lastTouched) ────────────────────────────────────────
function findOrCreate(store, id, name) {
  let p = store.projects.find((x) => x.id === id);
  if (!p) {
    p = { id, name: name || id, status: "active", todos: [], progressNote: null, created: nowIso(), lastTouched: nowIso() };
    store.projects.push(p);
  }
  return p;
}
export function createProject({ name, status = "active", progressNote = null }) {
  const store = loadStore();
  const id = slugify(name);
  const p = findOrCreate(store, id, name);
  p.status = status; if (progressNote) p.progressNote = progressNote; p.lastTouched = nowIso();
  saveStore(store); return p;
}
export function updateProject(id, patch) {
  const store = loadStore();
  const p = findOrCreate(store, id, patch.name);
  for (const k of ["name", "status", "progressNote", "inflightMatch"]) if (k in patch) p[k] = patch[k];
  p.lastTouched = nowIso();
  saveStore(store); return p;
}
export function addTodo(id, text, { name, by = "ui" } = {}) {
  const store = loadStore();
  const p = findOrCreate(store, id, name);
  const t = { id: uid(), text: String(text).trim(), done: false, created: nowIso(), doneAt: null, by };
  p.todos.push(t); p.lastTouched = nowIso();
  saveStore(store); return t;
}
export function updateTodo(id, tid, patch) {
  const store = loadStore();
  const p = store.projects.find((x) => x.id === id);
  if (!p) return null;
  const t = p.todos.find((x) => x.id === tid);
  if (!t) return null;
  if ("done" in patch) { t.done = !!patch.done; t.doneAt = t.done ? nowIso() : null; }
  if ("text" in patch) t.text = String(patch.text).trim();
  p.lastTouched = nowIso();
  saveStore(store); return t;
}
export function deleteTodo(id, tid) {
  const store = loadStore();
  const p = store.projects.find((x) => x.id === id);
  if (!p) return false;
  const n = p.todos.length;
  p.todos = p.todos.filter((x) => x.id !== tid);
  p.lastTouched = nowIso();
  saveStore(store); return p.todos.length < n;
}
