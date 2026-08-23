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
