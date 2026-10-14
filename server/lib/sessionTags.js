// Session tags (2026-10-14): every desktop session with one or more tags (job number, product, topic),
// its state (running / your turn / done) and the last PR it linked, so the Sessions page can show one
// session under several tags. The desktop sidebar allows one folder per session; this is the other views.
// All the work is ~/services/scripts/session-tags.py (rules from session-folders.json + Jake's prompts,
// Haiku only for sessions the rules leave untagged, cached per session). This file only runs it and
// keeps the last good answer, same shape as sessions.js.
import { execFile } from "child_process";
import { join } from "path";
import { homedir } from "os";

const SCRIPT = join(homedir(), "services", "scripts", "session-tags.py");
const REFRESH_MS = 2 * 60 * 1000;
const HAIKU_PER_RUN = 2; // untagged sessions asked per refresh; each answer is cached for good

let cache = { rows: null, at: 0, error: null };
let running = null;

function refresh() {
  if (running) return running;
  running = new Promise((resolve) => {
    execFile("python3", [SCRIPT, "--json", "--haiku", String(HAIKU_PER_RUN)],
      { timeout: 180000, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        try {
          if (err && !stdout) throw new Error((stderr || err.message || "").trim().slice(-400));
          cache = { rows: JSON.parse(stdout), at: Date.now(), error: null };
        } catch (e) {
          cache = { ...cache, error: e.message };
        }
        running = null;
        resolve();
      });
  });
  return running;
}

export async function listSessionTags() {
  if (!cache.rows) await refresh();
  else if (Date.now() - cache.at > REFRESH_MS) refresh();
  return {
    ok: !!cache.rows, rows: cache.rows || [], message: cache.rows ? undefined : cache.error,
    ageSec: Math.round((Date.now() - cache.at) / 1000), refreshError: cache.error || undefined,
  };
}

setTimeout(() => refresh(), 5000).unref?.();
