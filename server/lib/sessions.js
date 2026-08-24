// Sessions (2026-08-23): list / revive / stop / pin / park Claude Code sessions on the VPS.
// A session is a saved transcript plus a restartable process. Jake only kept dozens alive
// (~0.9 GB each) so his phone would have something to tap; 37 of them OOM'd the box on 8/22.
// Revive brings a dead one back under the `risingcreek-ai` device (phone-reachable, full
// history), which makes parking idle ones safe. All the work is ~/services/scripts/sessions.py;
// this file only spawns it (execFile, never execSync — see docker.js for why) and owns the
// auto-park timer, so the toggle on the Sessions page is the whole schedule (no crontab).
// Settings file is shared with the script: ~/services/config/sessions.json.
import { execFile } from "child_process";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

const SCRIPT = join(homedir(), "services", "scripts", "sessions.py");
const SETTINGS_PATH = join(homedir(), "services", "config", "sessions.json");
const DEFAULT_SETTINGS = { autoPark: false, autoRevive: false, parkHours: 3, compactKB: 650, listCount: 15, pinned: [] };
const UUID = /^[0-9a-f-]{36}$/;
const AUTO_PARK_EVERY_MS = 15 * 60 * 1000;

function run(args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile("python3", [SCRIPT, ...args], { timeout, encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = (stdout || "").trim();
        if (err && !out) resolve({ ok: false, message: (stderr || err.message || "").trim().slice(-800) });
        else resolve({ ok: !err, message: out || (stderr || "").trim() });
      });
  });
}

export function getSettings() {
  try {
    if (!existsSync(SETTINGS_PATH)) return { ...DEFAULT_SETTINGS };
    const d = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    return { ...DEFAULT_SETTINGS, ...d };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const cur = getSettings();
  const next = { ...cur };
  if (typeof patch.autoPark === "boolean") next.autoPark = patch.autoPark;
  if (typeof patch.autoRevive === "boolean") next.autoRevive = patch.autoRevive;
  if (Number.isFinite(+patch.parkHours) && +patch.parkHours >= 0.5) next.parkHours = Math.round(+patch.parkHours * 4) / 4;
  if (Number.isFinite(+patch.compactKB) && +patch.compactKB >= 100) next.compactKB = Math.round(+patch.compactKB);
  if (Number.isFinite(+patch.listCount) && +patch.listCount >= 5) next.listCount = Math.min(60, Math.round(+patch.listCount));
  if (Array.isArray(patch.pinned)) next.pinned = patch.pinned.filter((u) => UUID.test(u));
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  const tmp = SETTINGS_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, SETTINGS_PATH);
  return next;
}

export async function listSessions() {
  // Full list, not just settings.listCount: the page trims to listCount for display but
  // searches/filters across everything (99 qualified when this shipped). Same sort as
  // Telegram's /sessions, so the /revive numbering index stays consistent.
  const r = await run(["list", "--n", "400", "--json"]);
  if (!r.ok) return { ok: false, message: r.message, sessions: [] };
  try {
    const rows = JSON.parse(r.message);
    return {
      ok: true,
      sessions: rows.map((s) => ({
        uuid: s.uuid, title: s.title || s.first || s.uuid.slice(0, 8), state: s.state, how: s.how || "",
        pinned: !!s.pinned, sizeKB: Math.round(s.size / 1024), lastActivity: new Date(s.mtime * 1000).toISOString(),
        cwd: s.cwd,
      })),
    };
  } catch (e) {
    return { ok: false, message: `bad list output: ${e.message}`, sessions: [] };
  }
}

export function isUuid(u) { return UUID.test(u || ""); }
export const reviveSession = (uuid) => run(["revive", uuid], 200000);
export const stopSession = (uuid) => run(["stop", uuid]);
export const pinSession = (uuid, on) => run([on ? "pin" : "unpin", uuid]);
export const parkSessions = (apply) => run(["park", ...(apply ? ["--apply"] : [])], 60000);

// Auto-park: the dashboard process is the scheduler. Nothing runs unless settings.autoPark
// is true, and the script re-checks the flag itself (--auto). Failure mode is "nothing parked",
// never "something extra killed".
export function startAutoPark(onParked) {
  const tick = async () => {
    if (!getSettings().autoPark) return;
    const r = await run(["park", "--auto", "--apply"], 60000);
    if (r.ok && /^Parked/.test(r.message)) onParked?.(r.message);
  };
  setTimeout(tick, 60 * 1000).unref?.();
  setInterval(tick, AUTO_PARK_EVERY_MS).unref?.();
}

// Auto-revive (2026-08-24): pin = keep alive. Same scheduler shape as auto-park, opposite
// direction — if a PINNED session's process is gone (reboot, OOM kill, accidental stop),
// revive it. Off by default. First check 90s after server start, so a reboot self-heals
// right after start.sh brings this process back. Revives run one at a time (each spawns a
// ~0.5 GB claude in tmux), and a session that fails 3 straight ticks is left alone until
// the next server restart so a broken one (removed worktree, bad transcript) can't retry
// every 15 minutes forever. Failure mode is "nothing revived", never "something killed".
const reviveFails = new Map();
export async function runAutoRevive(onMsg) {
  const cfg = getSettings();
  if (!cfg.autoRevive || !cfg.pinned?.length) return { checked: 0, revived: 0 };
  const list = await listSessions();
  if (!list.ok) return { checked: 0, revived: 0, error: list.message };
  const dead = list.sessions.filter((s) => s.state !== "live" && cfg.pinned.includes(s.uuid));
  let revived = 0;
  for (const s of dead) {
    if ((reviveFails.get(s.uuid) || 0) >= 3) continue;
    const r = await reviveSession(s.uuid);
    if (r.ok && !/failed|did not come online|Cannot revive/i.test(r.message)) {
      reviveFails.delete(s.uuid);
      revived++;
      onMsg?.(`Auto-revived pinned session: ${s.title}`);
    } else {
      const n = (reviveFails.get(s.uuid) || 0) + 1;
      reviveFails.set(s.uuid, n);
      onMsg?.(`Auto-revive of pinned "${s.title}" failed (${n}/3${n >= 3 ? ", giving up until restart" : ""}): ${r.message}`.slice(0, 400));
    }
  }
  return { checked: dead.length, revived };
}
export function startAutoRevive(onMsg) {
  const tick = () => runAutoRevive(onMsg).catch(() => {});
  setTimeout(tick, 90 * 1000).unref?.();
  setInterval(tick, AUTO_PARK_EVERY_MS).unref?.();
}
