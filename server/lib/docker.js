import { execFile } from "child_process";

// 2026-08-16: was execSync — every `docker exec` (openclaw status, cat workspace
// files) froze the whole API for 9-19 s, so EVERY endpoint queued behind the
// status/crons polls and the UI read as dead ("No data", "loading…"). Now async,
// with a short read cache so five panels polling don't fan out five execs.
const CONTAINER = process.env.OPENCLAW_CONTAINER || "openclaw";
const TIMEOUT = 15_000;
const CACHE_MS = 20_000;
const cache = new Map(); // command → { at, result }

function run(command, timeout = TIMEOUT) {
  return new Promise((resolve) => {
    // shell-split the way execSync did (commands here are simple: `openclaw status --json`, `cat <path>`)
    const args = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g).map((a) => a.replace(/^["']|["']$/g, ""));
    execFile("docker", ["exec", CONTAINER, ...args], { timeout, encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: (stderr || "").trim() || err.message, code: err.code });
        resolve({ ok: true, data: (stdout || "").trim() });
      });
  });
}

export async function execDocker(command, { cacheMs = CACHE_MS, timeout } = {}) {
  const now = Date.now();
  const hit = cacheMs > 0 && cache.get(command);
  if (hit && now - hit.at < cacheMs) return hit.result;
  const result = await run(command, timeout);
  if (cacheMs > 0 && result.ok) cache.set(command, { at: now, result });
  return result;
}

export async function execDockerJSON(command, opts) {
  const result = await execDocker(command, opts);
  if (!result.ok) return result;
  try {
    return { ok: true, data: JSON.parse(result.data) };
  } catch {
    return { ok: true, data: result.data };
  }
}

// `openclaw status --json` takes ~10 s in the container, and the page poll plus the 30 s
// broadcast poll both asked for it, so the Brief waited on the Claw. Serve the last good
// answer instantly (with its age) and refresh in the background once it is over 60 s old.
// Only the first call after boot waits. A failed refresh keeps the last good copy.
const CLAW_REFRESH_MS = 60_000;
let claw = { result: null, at: 0, error: null };
let clawInflight = null;
let clawBackoffUntil = 0; // while the Claw is down, don't spawn a 45 s docker exec on every poll

export function refreshClawStatus() {
  if (!clawInflight && Date.now() < clawBackoffUntil) return Promise.resolve({ ok: false, error: claw.error || "backing off" });
  if (!clawInflight) {
    clawInflight = execDockerJSON("openclaw status --json", { cacheMs: 0, timeout: 45_000 }).then((r) => {
      if (r.ok && r.data && typeof r.data === "object") { claw = { result: r, at: Date.now(), error: null }; clawBackoffUntil = 0; }
      else { claw = { ...claw, error: r.error || "status returned no JSON" }; clawBackoffUntil = Date.now() + 60_000; }
      return r;
    }).finally(() => { clawInflight = null; });
  }
  return clawInflight;
}

export async function getClawStatus() {
  if (!claw.result) {
    const r = await refreshClawStatus();
    if (!claw.result) return r.ok ? { ok: false, error: claw.error } : r;
  } else if (Date.now() - claw.at > CLAW_REFRESH_MS) {
    refreshClawStatus().catch(() => {});
  }
  return { ...claw.result, ageSec: Math.round((Date.now() - claw.at) / 1000), refreshError: claw.error || undefined };
}
setTimeout(() => refreshClawStatus().catch(() => {}), 4000).unref?.();
