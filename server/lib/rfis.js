// RFI read layer (DESIGN.md §4). Reads each job dir's rfi.json directly — never the
// rendered markdown. RFI-LOG-INTERNAL.md is never loaded by this app.
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const JOBS_DIR = () => join(process.env.SERVICES_DIR || join(homedir(), "services"), "rising-creek", "jobs");

export const STAGES = ["needs_answer", "agreed", "our_move", "closed"];

export function stageOf(item) {
  if (item.status === "closed") return "closed";
  if (STAGES.includes(item.stage)) return item.stage;
  return item.status === "cleanup" ? "our_move" : "needs_answer";
}

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
      const stages = { needs_answer: 0, agreed: 0, our_move: 0, closed: 0 };
      let blockingOpen = 0;
      for (const g of rfi.groups || []) for (const it of g.items || []) {
        counts[it.status] = (counts[it.status] || 0) + 1;
        const stage = stageOf(it);
        stages[stage]++;
        if (it.status === "blocking" && stage !== "closed") blockingOpen++;
      }
      out.push({ dir: d, jobId: d.split("-")[0], job: rfi.job || d, title: rfi.title || "", revised: rfi.revised || null, mtime: statSync(f).mtime, counts, stages, blockingOpen, jobLog: jobLogDrift(join(jobsDir, d), rfi.revised) });
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
    for (const g of rfi.groups || []) for (const it of g.items || []) it.stage = stageOf(it);
    return { dir: d, jobId: d.split("-")[0], ...rfi, jobLog: jobLogDrift(join(jobsDir, d), rfi.revised) };
  } catch { return null; }
}

// Phase 2: the ONLY write path. Validated fields, atomic tmp+rename (same
// pattern as lib/projects.js). Regenerating RFI-LOG.md stays out of scope — the
// script that renders markdown keeps owning it.
import { writeFileSync, renameSync } from "fs";
const VALID_STATUS = ["blocking", "before_submittal", "cleanup", "closed"];
const STAGE_WORDS = { needs_answer: "needs an answer", agreed: "agreed, waiting on drawings", our_move: "our move", closed: "closed" };

export function updateRfiItem(jobId, itemId, { status, note, stage, stands, next }) {
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
  if (stage !== undefined && !STAGES.includes(stage)) return { error: `stage must be one of ${STAGES.join("/")}` };
  if (status !== undefined && !VALID_STATUS.includes(status)) return { error: `status must be one of ${VALID_STATUS.join("/")}` };
  if (stands !== undefined) {
    if (typeof stands !== "string") return { error: "stands must be a string" };
    stands = stands.replace(/(?:\r?\n)+/g, " ").trim();
    if (stands.length > 400) return { error: "stands must be at most 400 characters" };
  }
  if (next !== undefined && next !== null) {
    if (typeof next !== "object" || Array.isArray(next) || typeof next.who !== "string" || typeof next.what !== "string") return { error: "next must be an object with who and what strings, or null" };
    next = { who: next.who.trim(), what: next.what.trim() };
    if (next.who.length > 120 || next.what.length > 300) return { error: "next who/what must be at most 120/300 characters" };
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  if (stage !== undefined) {
    const oldStage = stageOf(item);
    item.stage = stage;
    if (stage === "closed") item.status = "closed";
    else if (item.status === "closed") item.status = "before_submittal";
    if (stage !== oldStage) {
      if (!Array.isArray(item.log)) item.log = [];
      item.log.push({ ts: new Date().toISOString(), who: "RCC", note: `Stage: ${STAGE_WORDS[oldStage]} → ${STAGE_WORDS[stage]}` });
    }
  }
  if (status !== undefined) {
    if (status === "closed") item.stage = "closed";
    else if (stageOf(item) === "closed") item.stage = "needs_answer";
    item.status = status;
  }
  if (stands !== undefined) {
    if (stands) item.stands = stands;
    else delete item.stands;
  }
  if (next !== undefined) {
    if (next === null) delete item.next;
    else item.next = { ...next, since: next.who === item.next?.who && next.what === item.next?.what ? item.next.since : today };
  }
  if (note) {
    if (!Array.isArray(item.log)) item.log = [];
    item.log.push({ ts: new Date().toISOString(), who: "RCC", note: String(note).replace(/(?:\r?\n)+/g, " ").slice(0, 2000) });
  }
  rfi.revised = today;
  const tmp = f + ".tmp";
  writeFileSync(tmp, JSON.stringify(rfi, null, 1));
  renameSync(tmp, f);
  return { ok: true, item: { ...item, stage: stageOf(item) } };
}
