// Access map (/access): the inventory of every credential, service connection, cron and
// Bitwarden account on this box. scripts/access-map.py (services repo) writes ONE json file,
// ~/.local/share/access-map/latest.json (0600, no secret values, only HMAC fingerprints); this
// module serves it, serves a sample fixture when it does not exist yet, and starts the
// collector on demand. Contract: docs/access-map-schema.md in the services repo.
//
// Refresh is one-at-a-time. The lock is a module-level flag (this process) PLUS a
// ~/.local/share/access-map/.running file (survives an API restart while the detached
// collector is still going). The file is owned by this server: the collector must not read
// its existence as "another run is going". A lock file whose pid is dead, or older than
// STALE_LOCK_MS, is cleared on the next check.
//
// The collector is spawned with an argument array (never a shell string), detached, with
// stdout+stderr appended to refresh.log, and an env stripped of CLAUDE* (so it can never
// ride this session's Claude login) and of this dashboard's own auth secrets.
//
// Test/ops knobs (all optional): ACCESS_MAP_PATH (data file), ACCESS_MAP_DIR (lock/log/state
// dir), ACCESS_MAP_SCRIPT (collector path).
import process from "node:process";
import { Buffer } from "node:buffer";
import { spawn } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync, existsSync, statSync, readSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const STALE_LOCK_MS = 30 * 60 * 1000; // a collector run is minutes, not half an hour
const MAX_LOG_BYTES = 512 * 1024; // start a fresh log past this
const TAIL_LINES = 30;
const FIXTURE = join(import.meta.dirname, "..", "fixtures", "access-map.sample.json");

const dir = () => process.env.ACCESS_MAP_DIR || join(homedir(), ".local", "share", "access-map");
const dataPath = () => process.env.ACCESS_MAP_PATH || join(dir(), "latest.json");
const lockPath = () => join(dir(), ".running");
const logPath = () => join(dir(), "refresh.log");
const statePath = () => join(dir(), ".last-run.json");
const scriptPath = () => process.env.ACCESS_MAP_SCRIPT || join(homedir(), "services", "scripts", "access-map.py");

// This process's own view of the run it started. Null when idle (or after an API restart).
let live = null;

// ── Data ─────────────────────────────────────────────────────

// { data, sample }. A missing file serves the fixture with sample:true added. A file that
// exists but cannot be parsed THROWS: silently showing sample data over a corrupt real file
// would look like a healthy inventory.
export function readAccessMap() {
  let raw;
  try {
    raw = readFileSync(dataPath(), "utf-8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const sample = JSON.parse(readFileSync(FIXTURE, "utf-8"));
    return { data: { ...sample, sample: true }, sample: true };
  }
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("access map file is not a JSON object");
  return { data, sample: false };
}

// ── Refresh lock ─────────────────────────────────────────────

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; } };

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function removeLock() {
  try { unlinkSync(lockPath()); } catch { /* already gone */ }
}

// True when a collector run is in flight. Clears a stale lock as a side effect.
function lockHeld() {
  if (live) return true;
  let st;
  try { st = statSync(lockPath()); } catch { return false; }
  const ageMs = Date.now() - st.mtimeMs;
  // Tolerate a lock that is plain text or not JSON at all: age alone then decides.
  let pid = null;
  try {
    const txt = readFileSync(lockPath(), "utf-8").trim();
    const parsed = txt.startsWith("{") ? JSON.parse(txt).pid : parseInt(txt, 10);
    pid = Number.isInteger(parsed) ? parsed : null;
  } catch { /* unreadable: fall back to age */ }
  if (ageMs > STALE_LOCK_MS || (pid != null && !pidAlive(pid))) { removeLock(); return false; }
  return true;
}

function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("CLAUDE")) continue;
    if (k === "MISSION_CONTROL_PASSPHRASE" || k === "MISSION_CONTROL_SESSION_SECRET") continue;
    env[k] = v;
  }
  return env;
}

function appendLog(fd, text) {
  try { writeFileSync(fd, text); } catch { /* the log is a convenience */ }
}

function finish(startedAt, probe, exitCode, signal) {
  const finishedAt = new Date().toISOString();
  try { writeFileSync(statePath(), JSON.stringify({ startedAt, finishedAt, exitCode, signal: signal || null, probe }), { mode: 0o600 }); } catch { /* ok */ }
  removeLock();
  live = null;
}

// → { started: true, startedAt } or { started: false, running: true } or throws.
export function startRefresh({ probe = false } = {}) {
  const script = scriptPath();
  if (!existsSync(script)) throw new Error(`collector not found: ${script}`);
  if (lockHeld()) return { started: false, running: true };

  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  try {
    writeFileSync(lockPath(), JSON.stringify({ startedAt, probe, by: "mission-control" }), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e.code === "EEXIST") return { started: false, running: true };
    throw e;
  }

  let fd;
  try {
    let flags = "a";
    try { if (statSync(logPath()).size > MAX_LOG_BYTES) flags = "w"; } catch { /* no log yet */ }
    fd = openSync(logPath(), flags, 0o600);
    appendLog(fd, `\n=== ${startedAt} access-map.py${probe ? " --probe" : ""} ===\n`);
    const args = [script, ...(probe ? ["--probe"] : [])];
    const child = spawn("python3", args, {
      cwd: join(homedir(), "services"),
      detached: true,
      stdio: ["ignore", fd, fd],
      env: cleanEnv(),
    });
    live = { startedAt, probe, pid: child.pid ?? null };
    // spawn failures (python3 missing) arrive here, not as a throw.
    child.on("error", (err) => {
      try { const f = openSync(logPath(), "a", 0o600); appendLog(f, `spawn error: ${err.message}\n`); closeSync(f); } catch { /* ok */ }
      finish(startedAt, probe, -1, null);
    });
    child.on("exit", (code, signal) => finish(startedAt, probe, code, signal));
    child.unref();
    try { writeFileSync(lockPath(), JSON.stringify({ startedAt, probe, pid: child.pid ?? null, by: "mission-control" }), { mode: 0o600 }); } catch { /* ok */ }
    try { writeFileSync(statePath(), JSON.stringify({ startedAt, finishedAt: null, exitCode: null, signal: null, probe }), { mode: 0o600 }); } catch { /* ok */ }
  } catch (e) {
    live = null;
    removeLock();
    throw e;
  } finally {
    if (fd != null) closeSync(fd); // the child holds its own copy
  }
  return { started: true, startedAt };
}

// ── Status ───────────────────────────────────────────────────

function logTail() {
  let size;
  try { size = statSync(logPath()).size; } catch { return []; }
  const want = Math.min(size, 32 * 1024);
  const buf = Buffer.alloc(want);
  let fd;
  try {
    fd = openSync(logPath(), "r");
    readSync(fd, buf, 0, want, size - want);
  } catch { return []; } finally { if (fd != null) closeSync(fd); }
  const lines = buf.toString("utf-8").split("\n");
  if (size > want) lines.shift(); // first line is cut mid-way
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-TAIL_LINES);
}

// { running, startedAt, finishedAt, exitCode, logTail }
export function refreshStatus() {
  const running = lockHeld();
  let st = readJson(statePath()) || {};
  if (running) {
    const lock = readJson(lockPath());
    st = { startedAt: live?.startedAt ?? lock?.startedAt ?? st.startedAt ?? null, finishedAt: null, exitCode: null };
  } else if (st.startedAt && !st.finishedAt) {
    // The API restarted mid-run and the collector has since gone: no exit code survived.
    let finishedAt = null;
    try { finishedAt = statSync(logPath()).mtime.toISOString(); } catch { /* no log */ }
    st = { ...st, finishedAt, exitCode: null };
  }
  return {
    running,
    startedAt: st.startedAt ?? null,
    finishedAt: st.finishedAt ?? null,
    exitCode: st.exitCode ?? null,
    logTail: logTail(),
  };
}
