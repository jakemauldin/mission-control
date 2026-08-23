// RFI read layer (DESIGN.md §4). Reads each job dir's rfi.json directly — never the
// rendered markdown. RFI-LOG-INTERNAL.md is never loaded by this app.
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const JOBS_DIR = join(homedir(), "services", "rising-creek", "jobs");

export function listRfiJobs() {
  const out = [];
  let dirs = [];
  try { dirs = readdirSync(JOBS_DIR); } catch { return out; }
  for (const d of dirs) {
    const f = join(JOBS_DIR, d, "rfi.json");
    if (!existsSync(f)) continue;
    try {
      const rfi = JSON.parse(readFileSync(f, "utf-8"));
      const counts = { blocking: 0, before_submittal: 0, cleanup: 0, closed: 0 };
      for (const g of rfi.groups || []) for (const it of g.items || []) counts[it.status] = (counts[it.status] || 0) + 1;
      out.push({ dir: d, jobId: d.split("-")[0], job: rfi.job || d, title: rfi.title || "", revised: rfi.revised || null, mtime: statSync(f).mtime, counts });
    } catch { /* malformed — skip */ }
  }
  return out;
}

export function getRfi(jobId) {
  let dirs = [];
  try { dirs = readdirSync(JOBS_DIR); } catch { return null; }
  const d = dirs.find(x => x === jobId || x.startsWith(jobId + "-"));
  if (!d) return null;
  const f = join(JOBS_DIR, d, "rfi.json");
  if (!existsSync(f)) return null;
  try { return { dir: d, jobId: d.split("-")[0], ...JSON.parse(readFileSync(f, "utf-8")) }; } catch { return null; }
}

// Media counts for the /media strip — same undecided logic as the Brief's tier 5.
const MEDIA = "/mnt/rc_media/media-library/rising-creek";
export function mediaCounts() {
  const read = (f) => { try { const d = JSON.parse(readFileSync(join(MEDIA, f), "utf-8")); return Array.isArray(d) ? d : Object.keys(d); } catch { return []; } };
  const cat = read("_catalogue.json");
  const buckets = { approved: read("_approved.json"), postable: read("_postable.json"), trash: read("_trash.json"), records: read("_records.json"), personal: read("_personal.json") };
  const decided = new Set(Object.values(buckets).flat());
  return {
    catalogued: cat.length,
    undecided: cat.filter(k => !decided.has(k)).length,
    ...Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  };
}

// Phase 2: the ONLY write path. Two fields, validated, atomic tmp+rename (same
// pattern as lib/projects.js). Regenerating RFI-LOG.md stays out of scope — the
// script that renders markdown keeps owning it.
import { writeFileSync, renameSync } from "fs";
const VALID_STATUS = ["blocking", "before_submittal", "cleanup", "closed"];

export function updateRfiItem(jobId, itemId, { status, note }) {
  let dirs = [];
  try { dirs = readdirSync(JOBS_DIR); } catch { return { error: "jobs dir unreadable" }; }
  const d = dirs.find(x => x === jobId || x.startsWith(jobId + "-"));
  if (!d) return { error: "job not found" };
  const f = join(JOBS_DIR, d, "rfi.json");
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

// Media visuals: thumbnails already exist in _thumbs (gallery's cache-first scheme:
// key = rel path with non-alnum → "_" + "_340.jpg"). We serve ONLY from the cache,
// never generate — the gallery owns generation.
export function thumbPathFor(rel) {
  const key = String(rel).replace(/[^A-Za-z0-9]/g, "_") + "_340.jpg";
  return join(MEDIA, "_thumbs", key);
}

export function recentMedia(bucket = "postable", n = 24) {
  const listFile = { postable: "_postable.json", approved: "_approved.json" }[bucket];
  if (!listFile) return [];
  let labels = [];
  try { const d = JSON.parse(readFileSync(join(MEDIA, listFile), "utf-8")); labels = Array.isArray(d) ? d : Object.keys(d); } catch { return []; }
  let cat = {};
  try { cat = JSON.parse(readFileSync(join(MEDIA, "_catalogue.json"), "utf-8")); } catch { /* thin result */ }
  const out = [];
  for (const label of labels.slice().reverse()) {   // newest additions last in file → reverse
    const entry = cat[label];
    const file = entry?.file;
    if (!file) continue;
    if (!existsSync(thumbPathFor(file))) continue;  // only show what can render
    out.push({ label, file, shows: entry.shows || "" });
    if (out.length >= n) break;
  }
  return out;
}
