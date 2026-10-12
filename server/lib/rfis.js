// RFI read layer (DESIGN.md §4). Reads each job dir's rfi.json directly — never the
// rendered markdown. RFI-LOG-INTERNAL.md is never loaded by this app.
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const JOBS_DIR = () => join(process.env.SERVICES_DIR || join(homedir(), "services"), "rising-creek", "jobs");

export function jobLogDrift(jobDir, revised) {
  let text = "";
  try { text = readFileSync(join(jobDir, "JOB-LOG.md"), "utf-8"); } catch { return { after: 0, latest: null }; }
  revised ||= statSync(join(jobDir, "rfi.json")).mtime.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  let after = 0, latest = null;
  for (const m of text.matchAll(/^## (\d{4}-\d{2}-\d{2})\b/gm)) {
    if (!latest || m[1] > latest) latest = m[1];
    if (m[1] > revised) after++;
  }
  return { after, latest };
}

export function listRfiJobs() {
  const out = [];
  const jobsDir = JOBS_DIR();
  let dirs = [];
  try { dirs = readdirSync(jobsDir); } catch { return out; }
  for (const d of dirs) {
    const f = join(jobsDir, d, "rfi.json");
    if (!existsSync(f)) continue;
    try {
      const rfi = JSON.parse(readFileSync(f, "utf-8"));
      const counts = { blocking: 0, before_submittal: 0, cleanup: 0, closed: 0 };
      for (const g of rfi.groups || []) for (const it of g.items || []) counts[it.status] = (counts[it.status] || 0) + 1;
      out.push({ dir: d, jobId: d.split("-")[0], job: rfi.job || d, title: rfi.title || "", revised: rfi.revised || null, mtime: statSync(f).mtime, counts, jobLog: jobLogDrift(join(jobsDir, d), rfi.revised) });
    } catch { /* malformed — skip */ }
  }
  return out;
}

export function getRfi(jobId) {
  const jobsDir = JOBS_DIR();
  let dirs = [];
  try { dirs = readdirSync(jobsDir); } catch { return null; }
  const d = dirs.find(x => x === jobId || x.startsWith(jobId + "-"));
  if (!d) return null;
  const f = join(jobsDir, d, "rfi.json");
  if (!existsSync(f)) return null;
  try {
    const rfi = JSON.parse(readFileSync(f, "utf-8"));
    return { dir: d, jobId: d.split("-")[0], ...rfi, jobLog: jobLogDrift(join(jobsDir, d), rfi.revised) };
  } catch { return null; }
}

// Phase 2: the ONLY write path. Two fields, validated, atomic tmp+rename (same
// pattern as lib/projects.js). Regenerating RFI-LOG.md stays out of scope — the
// script that renders markdown keeps owning it.
import { writeFileSync, renameSync } from "fs";
const VALID_STATUS = ["blocking", "before_submittal", "cleanup", "closed"];

export function updateRfiItem(jobId, itemId, { status, note }) {
  let dirs = [];
  try { dirs = readdirSync(JOBS_DIR()); } catch { return { error: "jobs dir unreadable" }; }
  const d = dirs.find(x => x === jobId || x.startsWith(jobId + "-"));
  if (!d) return { error: "job not found" };
  const f = join(JOBS_DIR(), d, "rfi.json");
  if (!existsSync(f)) return { error: "no rfi.json" };
  const rfi = JSON.parse(readFileSync(f, "utf-8"));
  let item = null;
  for (const g of rfi.groups || []) for (const it of g.items || []) if (it.id === itemId) item = it;
  if (!item) return { error: `item ${itemId} not found` };
  if (status !== undefined) {
    if (!VALID_STATUS.includes(status)) return { error: `status must be one of ${VALID_STATUS.join("/")}` };
    item.status = status;
  }
  if (note) {
    if (!Array.isArray(item.log)) item.log = [];
    item.log.push({ ts: new Date().toISOString(), who: "RCC", note: String(note).slice(0, 2000) });
  }
  rfi.revised = new Date().toISOString().slice(0, 10);
  const tmp = f + ".tmp";
  writeFileSync(tmp, JSON.stringify(rfi, null, 2));
  renameSync(tmp, f);
  return { ok: true, item };
}
