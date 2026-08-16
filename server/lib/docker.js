import { execFile } from "child_process";

// 2026-08-16: was execSync — every `docker exec` (openclaw status, cat workspace
// files) froze the whole API for 9-19 s, so EVERY endpoint queued behind the
// status/crons polls and the UI read as dead ("No data", "loading…"). Now async,
// with a short read cache so five panels polling don't fan out five execs.
const CONTAINER = process.env.OPENCLAW_CONTAINER || "openclaw";
const TIMEOUT = 15_000;
const CACHE_MS = 20_000;
const cache = new Map(); // command → { at, result }

function run(command) {
  return new Promise((resolve) => {
    // shell-split the way execSync did (commands here are simple: `openclaw status --json`, `cat <path>`)
    const args = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g).map((a) => a.replace(/^["']|["']$/g, ""));
    execFile("docker", ["exec", CONTAINER, ...args], { timeout: TIMEOUT, encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: (stderr || "").trim() || err.message, code: err.code });
        resolve({ ok: true, data: (stdout || "").trim() });
      });
  });
}

export async function execDocker(command, { cacheMs = CACHE_MS } = {}) {
  const now = Date.now();
  const hit = cacheMs > 0 && cache.get(command);
  if (hit && now - hit.at < cacheMs) return hit.result;
  const result = await run(command);
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
