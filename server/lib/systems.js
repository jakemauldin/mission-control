// Systems outcomes (DESIGN.md §6): "did the thing that was supposed to happen actually
// land", never "is the container up". Monitored jobs are a JSON line in
// server/data/system-expectations.json — {name, artifactPath, maxAgeHours, minBytes, owner}
// — not code. Backups get a deeper check: the success LINE, searched through logrotate's
// .gz rotations, because copytruncate wipes the live file daily and an mtime check alone
// reported two healthy jobs dead on 2026-08-23.
import { readFileSync, readdirSync, statSync, existsSync, statfsSync } from "fs";
import { gunzipSync } from "zlib";
import { join } from "path";
import { homedir } from "os";
import { execFile } from "child_process";

const HOME = homedir();
const LOGS = join(HOME, "services", "logs");
const EXPECTATIONS = join(import.meta.dirname, "..", "data", "system-expectations.json");

function lastSuccess(path, pat) {
  // newest timestamp matching pat across live file + up to 4 rotations
  let txt = "";
  try { txt += readFileSync(path, "utf-8"); } catch { /* absent */ }
  for (let i = 1; i <= 4; i++) {
    try { txt += "\n" + gunzipSync(readFileSync(`${path}.${i}.gz`)).toString(); } catch { /* no rotation */ }
  }
  const stamps = [];
  for (const line of txt.split("\n")) {
    if (pat.test(line)) {
      const m = /([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2})/.exec(line);
      if (m) stamps.push(m[1].replace("T", " "));
    }
  }
  return stamps.sort().pop() || null;
}

function backupCards() {
  const defs = [
    { name: "OpenClaw volume backup", path: "/var/log/openclaw-backup.log", pat: /Upload successful/, maxH: 26 },
    { name: "Services host backup", path: join(LOGS, "services-backup.log"), pat: /Backup Complete/, maxH: 26 },
    { name: "TC databases backup", path: join(LOGS, "tc-backup.log"), pat: /TC Database Backup/, maxH: 26 },
    { name: "Media mirror (Spaces)", path: join(LOGS, "media-mirror.log"), pat: /Media mirror complete/, maxH: 192 },
  ];
  return defs.map(d => {
    const last = lastSuccess(d.path, d.pat);
    const ageH = last ? (Date.now() - Date.parse(last)) / 3600000 : Infinity;
    return { kind: "backup", name: d.name, last, ageHours: last ? Math.round(ageH) : null, ok: ageH <= d.maxH, detail: last ? `last success ${last}` : "no success found" };
  });
}

function diskCards() {
  const out = [];
  for (const [name, p] of [["Root disk", "/"], ["rc-media volume", "/mnt/rc_media"]]) {
    try {
      const s = statfsSync(p);
      const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
      const pct = Math.round((1 - free / total) * 100);
      out.push({ kind: "disk", name, ok: pct < 90, pct, freeGB: Math.round(free / 1073741824), detail: `${pct}% used, ${Math.round(free / 1073741824)}G free (live df)` });
    } catch { out.push({ kind: "disk", name, ok: false, detail: "unreadable — mount missing?" }); }
  }
  // mount assertion: the media primary being offline is a red card, not a footnote
  try {
    const mounted = readFileSync("/proc/mounts", "utf-8").split("\n").some(l => l.split(" ")[1] === "/mnt/rc_media");
    if (!mounted) out.push({ kind: "disk", name: "rc-media MOUNT", ok: false, detail: "NOT MOUNTED — media primary offline" });
  } catch { /* ignore */ }
  return out;
}

function expectationCards() {
  let entries = [];
  try { entries = JSON.parse(readFileSync(EXPECTATIONS, "utf-8")); } catch { return []; }
  return entries.map(e => {
    try {
      const st = statSync(e.artifactPath);
      const ageH = (Date.now() - st.mtimeMs) / 3600000;
      const sizeOk = st.size >= (e.minBytes || 0);
      const ageOk = ageH <= e.maxAgeHours;
      return { kind: "cron", name: e.name, ok: ageOk && sizeOk, owner: e.owner, detail: `${Math.round(ageH)}h old, ${st.size}B${ageOk ? "" : " — STALE"}${sizeOk ? "" : " — EMPTY"}` };
    } catch { return { kind: "cron", name: e.name, ok: false, owner: e.owner, detail: "artifact missing" }; }
  });
}

// containers via HOST docker (this API is a host process) — async + cached, never sync
let dockerCache = { at: 0, data: [] };
function containerCards() {
  return new Promise((resolve) => {
    if (Date.now() - dockerCache.at < 20000) return resolve(dockerCache.data);
    execFile("docker", ["ps", "--format", "{{.Names}}|{{.Status}}"], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([{ kind: "containers", name: "docker", ok: false, detail: "docker ps failed" }]);
      const rows = stdout.trim().split("\n").filter(Boolean).map(l => {
        const [name, status] = l.split("|");
        return { kind: "container", name, ok: /Up/.test(status), detail: status };
      });
      dockerCache = { at: Date.now(), data: rows };
      resolve(rows);
    });
  });
}

function healthSnapshot() {
  try {
    const files = readdirSync(LOGS).filter(f => /^health-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort().reverse();
    for (const f of files) {
      const txt = readFileSync(join(LOGS, f), "utf-8");
      if (!txt.trim()) continue; // logrotate zeroes older dated files
      const status = /STATUS:\s*(\w+)/.exec(txt)?.[1] || "UNKNOWN";
      const oom = /kernel events? in 24h|Out of memory/i.test(txt);
      return { kind: "health", name: `Health check (${f.replace("health-", "").replace(".log", "")} 01:00 snapshot)`, ok: status !== "RED", status, oomFlag: oom, detail: `STATUS: ${status} — snapshot, can lag live state` };
    }
  } catch { /* absent */ }
  return { kind: "health", name: "Health check", ok: false, detail: "no readable health log" };
}

export async function systemsOutcomes() {
  const containers = await containerCards();
  return {
    generated: new Date().toISOString(),
    backups: backupCards(),
    disk: diskCards(),
    crons: expectationCards(),
    containers,
    health: healthSnapshot(),
  };
}
