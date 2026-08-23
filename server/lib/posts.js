// Social post queue (Post Builder). Same contract philosophy as gen.js: the dashboard
// COMPOSES and previews; actual publishing goes through the existing pipelines
// (Meta backbone app, GBP, Pinterest recipes). Statuses: draft → approved → posted.
import { readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

const QDIR = join(import.meta.dirname, "..", "data", "social-post-queue");

export function createPost({ caption, overrides, platforms, refs, refsByPlatform, jobContext }) {
  mkdirSync(QDIR, { recursive: true });
  const id = `${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
  const post = {
    id, status: "draft", created: new Date().toISOString(),
    caption: String(caption || "").slice(0, 8000),
    overrides: overrides && typeof overrides === "object" ? overrides : {},   // per-platform caption overrides
    platforms: Array.isArray(platforms) ? platforms.slice(0, 8).map(String) : [],
    refs: Array.isArray(refs) ? refs.slice(0, 10).map(String) : [],
    // per-platform photo arrangements (Jake, 8/23): FB may run 4 photos while IG runs
    // one secondary shot that renders better. Key = platform, value = ORDERED ref list.
    refsByPlatform: refsByPlatform && typeof refsByPlatform === "object"
      ? Object.fromEntries(Object.entries(refsByPlatform).slice(0, 8).map(([k, v]) => [String(k), Array.isArray(v) ? v.slice(0, 10).map(String) : []]))
      : {},
    jobContext: String(jobContext || ""),
  };
  const f = join(QDIR, `${id}.json`);
  writeFileSync(f + ".tmp", JSON.stringify(post, null, 2));
  renameSync(f + ".tmp", f);
  return post;
}

const VALID_STATUS = ["draft", "approved", "posted", "abandoned"];
export async function updatePostStatus(id, status) {
  if (!VALID_STATUS.includes(status)) return { error: `status must be ${VALID_STATUS.join("/")}` };
  const f = join(QDIR, `${String(id).replace(/[^A-Za-z0-9-]/g, "")}.json`);
  if (!existsSync(f)) return { error: "post not found" };
  const p = JSON.parse(readFileSync(f, "utf-8"));
  p.status = status;
  p.statusChanged = new Date().toISOString();
  // A post marked POSTED is real published history — feed the learning corpus
  // (same file the Business-Suite export importer writes) so suggestions learn
  // from it immediately, no export round-trip needed.
  if (status === "posted") {
    try {
      const histFile = join(import.meta.dirname, "..", "data", "published-history.json");
      const hist = existsSync(histFile) ? JSON.parse(readFileSync(histFile, "utf-8")) : [];
      const { createHash } = await import("crypto");
      const hash = createHash("sha1").update(p.caption).digest("hex").slice(0, 12);
      if (!hist.some(h => h.hash === hash)) {
        hist.unshift({ hash, caption: p.caption.slice(0, 600), platform: (p.platforms || [])[0] || "facebook", date: new Date().toISOString().slice(0, 10), likes: null, comments: null, reach: null });
        writeFileSync(histFile + ".tmp", JSON.stringify(hist, null, 2)); renameSync(histFile + ".tmp", histFile);
      }
    } catch { /* learning is best-effort, never blocks the status change */ }
  }
  writeFileSync(f + ".tmp", JSON.stringify(p, null, 2));
  renameSync(f + ".tmp", f);
  return { ok: true, post: p };
}

export function listPosts() {
  if (!existsSync(QDIR)) return [];
  return readdirSync(QDIR).filter(f => f.endsWith(".json")).sort().reverse().slice(0, 30)
    .map(f => { try { return JSON.parse(readFileSync(join(QDIR, f), "utf-8")); } catch { return null; } })
    .filter(Boolean);
}
