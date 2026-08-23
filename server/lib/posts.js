// Social post queue (Post Builder). Same contract philosophy as gen.js: the dashboard
// COMPOSES and previews; actual publishing goes through the existing pipelines
// (Meta backbone app, GBP, Pinterest recipes). Statuses: draft → approved → posted.
import { readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

const QDIR = join(import.meta.dirname, "..", "data", "social-post-queue");

export function createPost({ caption, overrides, platforms, refs, jobContext }) {
  mkdirSync(QDIR, { recursive: true });
  const id = `${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
  const post = {
    id, status: "draft", created: new Date().toISOString(),
    caption: String(caption || "").slice(0, 8000),
    overrides: overrides && typeof overrides === "object" ? overrides : {},   // per-platform caption overrides
    platforms: Array.isArray(platforms) ? platforms.slice(0, 8).map(String) : [],
    refs: Array.isArray(refs) ? refs.slice(0, 10).map(String) : [],
    jobContext: String(jobContext || ""),
  };
  const f = join(QDIR, `${id}.json`);
  writeFileSync(f + ".tmp", JSON.stringify(post, null, 2));
  renameSync(f + ".tmp", f);
  return post;
}

export function listPosts() {
  if (!existsSync(QDIR)) return [];
  return readdirSync(QDIR).filter(f => f.endsWith(".json")).sort().reverse().slice(0, 30)
    .map(f => { try { return JSON.parse(readFileSync(join(QDIR, f), "utf-8")); } catch { return null; } })
    .filter(Boolean);
}
