// Open sign + ring (Jake: "when my sign is open an agent can ring me on the laptop").
//
// Flow: an agent POSTs /internal/ring from the host. If a device has its sign open and takes
// calls, we hand voice-dump the brief (so the voice knows why it is calling), chime that device
// over /ws, and wait for Answer. Answer returns the live-call URL plus the voice-dump token.
// Later, timeout, nobody present or a failed brief all fall back to Telegram (routine) or a cell
// call plus Telegram (urgent/critical). State lives in memory: a restart drops pending rings,
// which the caller sees as an unknown id and falls back on its own.
//
// Everything with a side effect (clock, http, telegram, token read, log) is injectable so
// ring.test.mjs can drive the state machine without a socket, a phone or a clock.

/* global process */
import { randomBytes } from "crypto";
import { execFile } from "child_process";
import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
// Any of these means the request came through a proxy (nginx, tailscale serve), so the socket
// address is the proxy's, not the caller's. voice-dump's authorized() uses the same rule.
const PROXY_HEADERS = ["x-forwarded-for", "x-real-ip", "forwarded", "tailscale-user-login", "tailscale-user-name"];

export function isBareLoopback(req) {
  const addr = req?.socket?.remoteAddress;
  if (!LOOPBACK.has(addr)) return false;
  const h = req.headers || {};
  return !PROXY_HEADERS.some((k) => h[k] !== undefined);
}

export function loopbackOnly(req, res, next) {
  if (isBareLoopback(req)) return next();
  res.status(403).json({ ok: false, error: "loopback only" });
}

const URGENCIES = ["routine", "urgent", "critical"];
const MSG_MAX_BYTES = 4096;
const MSG_RATE = { max: 20, windowMs: 10_000 };
const PING_MS = 20_000;
const DEAD_MS = 45_000;
const RING_RATE = { max: 3, windowMs: 10 * 60_000 };
const CELL_TOPIC_MS = 30 * 60_000;
const KEEP_MS = 60 * 60_000;
// A device with no live socket stays listed for 10 min (a reload, a laptop lid) and is forgotten after an hour.
const SHOW_OFFLINE_MS = 10 * 60_000;

// 21:00-06:00 America/Chicago is quiet; hour comes from Intl so DST is handled.
export function chicagoHour(ms) {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }).format(new Date(ms));
  return Number(h) % 24;
}
export function isQuietHour(ms) {
  const h = chicagoHour(ms);
  return h >= 21 || h < 6;
}

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const trimEnd = (s) => s.replace(/[\s.:;,!?-]+$/, "");

// "<from> wants to talk: <topic>. <first line of brief>. Open the dashboard or reply here."
// No ';' anywhere: tg-send once truncated at it, and the message is plain text for a phone.
export function telegramText({ from, topic, brief }) {
  const first = trimEnd(String(brief || "").split("\n").map((l) => l.trim()).find(Boolean) || "");
  const parts = [`${from || "Someone"} wants to talk: ${trimEnd(topic)}.`];
  if (first) parts.push(`${first}.`);
  parts.push("Open the dashboard or reply here.");
  return parts.join(" ").replace(/;/g, ",");
}

function defaultPostJson(url, body, timeoutMs = 5000) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).then(async (r) => ({ status: r.status, ok: r.ok, body: await r.text().catch(() => "") }));
}

function defaultTelegram(msg) {
  const script = join(homedir(), "services", "scripts", "tg-send.py");
  return new Promise((resolve, reject) => {
    execFile("python3", [script, "text", msg], { timeout: 30_000 }, (err) => (err ? reject(err) : resolve()));
  });
}

export function createRing(opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now || Date.now;
  const dryRun = opts.dryRun ?? env.RING_DRY_RUN === "1";
  const voiceDumpUrl = (opts.voiceDumpUrl || env.VOICE_DUMP_URL || "http://127.0.0.1:3240").replace(/\/$/, "");
  // Only POST the brief during a dry run when VOICE_DUMP_URL was set on purpose (a stub), so a
  // dry run on a test copy never writes into the real voice-dump.
  const briefLive = !dryRun || !!(opts.voiceDumpUrl || env.VOICE_DUMP_URL);
  const embedUrl = opts.liveEmbedUrl || env.LIVE_EMBED_URL || "https://risingcreek-ai.taild0b4c6.ts.net:3241/live";
  const tokenFile = opts.tokenFile || env.VOICE_DUMP_TOKEN_FILE || join(homedir(), ".secrets", "voice-dump-token");
  const logFile = opts.logFile || join(import.meta.dirname, "..", "data", "ring-log.jsonl");
  const num = (k, d) => (Number(env[k]) > 0 ? Number(env[k]) : d);
  const timeouts = opts.timeouts || {
    routine: num("RING_TIMEOUT_ROUTINE_MS", 45_000),
    urgent: num("RING_TIMEOUT_URGENT_MS", 25_000),
    critical: num("RING_TIMEOUT_CRITICAL_MS", 25_000),
  };
  const postJson = opts.postJson || defaultPostJson;
  const telegram = opts.telegram || defaultTelegram;
  const readToken = opts.readToken || (() => readFileSync(tokenFile, "utf8").trim());

  const devices = new Map();   // deviceId -> {id,label,open,takesCalls,dropIn,lastSeen,sockets:Set}
  const sockets = new Map();   // ws -> {deviceId|null, lastPong, stamps:[]}
  const rings = new Map();     // id -> record
  const ringStamps = new Map(); // from -> [ms]
  const cellStamps = new Map(); // topic key -> ms

  function log(entry) {
    try {
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(logFile, JSON.stringify({ t: new Date(now()).toISOString(), ...entry }) + "\n");
    } catch { /* a full disk must not break ringing */ }
  }

  // ── presence ───────────────────────────────────────────────
  const live = (ws) => ws.readyState === 1;
  const isReachable = (d) => d.open && d.takesCalls && [...d.sockets].some(live);
  const reachableDevices = () => [...devices.values()].filter(isReachable);
  const listed = () => [...devices.values()].filter((d) => d.sockets.size > 0 || now() - d.lastSeen < SHOW_OFFLINE_MS);
  const summary = () => listed().map((d) => ({
    id: d.id, label: d.label, open: d.open, takesCalls: d.takesCalls, dropIn: d.dropIn,
    lastSeen: new Date(d.lastSeen).toISOString(), connected: [...d.sockets].some(live),
  }));

  function send(ws, msg) {
    try { if (live(ws)) ws.send(JSON.stringify(msg)); } catch { /* socket closing */ }
  }
  function sendDevice(d, msg, except) {
    for (const ws of d.sockets) if (ws !== except) send(ws, msg);
  }
  function pushPresence() {
    const msg = { type: "presence", reachable: reachableDevices().length > 0, devices: summary() };
    for (const [ws, s] of sockets) if (s.deviceId) send(ws, msg);
  }

  function status() {
    return {
      reachable: reachableDevices().length > 0,
      devices: listed().map((d) => ({
        label: d.label, open: d.open, takesCalls: d.takesCalls, lastSeen: new Date(d.lastSeen).toISOString(),
      })),
    };
  }

  function attach(ws) {
    const s = { deviceId: null, lastPong: now(), stamps: [] };
    sockets.set(ws, s);
    ws.on("pong", () => { s.lastPong = now(); });
    ws.on("message", (raw) => onMessage(ws, s, raw));
    ws.on("close", () => detach(ws));
    ws.on("error", () => detach(ws));
  }
  function detach(ws) {
    const s = sockets.get(ws);
    if (!s) return;
    sockets.delete(ws);
    const d = s.deviceId && devices.get(s.deviceId);
    if (d) {
      d.sockets.delete(ws);
      pushPresence();
      for (const r of rings.values()) if (r.state === "ringing") maybeNoOneLeft(r);
    }
  }

  // ping every 20 s, terminate sockets silent for 45 s. Server pings, not client timers, so a
  // throttled background tab (timers ~1/min) still counts as present: browsers pong on their own.
  function sweep() {
    const t = now();
    for (const [id, d] of devices) if (d.sockets.size === 0 && t - d.lastSeen > KEEP_MS) devices.delete(id);
    for (const [ws, s] of sockets) {
      if (t - s.lastPong > DEAD_MS) { try { ws.terminate(); } catch { /* gone */ } detach(ws); continue; }
      try { ws.ping(); } catch { /* closing */ }
    }
  }
  let timer = null;
  function startHeartbeat() {
    if (timer) return;
    timer = setInterval(sweep, PING_MS);
    timer.unref?.();
  }

  function rateOk(s) {
    const t = now();
    s.stamps = s.stamps.filter((x) => t - x < MSG_RATE.windowMs);
    if (s.stamps.length >= MSG_RATE.max) return false;
    s.stamps.push(t);
    return true;
  }

  function onMessage(ws, s, raw) {
    const text = typeof raw === "string" ? raw : raw?.toString?.() ?? "";
    if (text.length > MSG_MAX_BYTES || !rateOk(s)) return;
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== "object") return;

    if (m.type === "hello") {
      const id = clip(m.deviceId, 64);
      if (!/^[\w-]{6,64}$/.test(id)) return;
      if (s.deviceId && s.deviceId !== id) devices.get(s.deviceId)?.sockets.delete(ws);
      s.deviceId = id;
      let d = devices.get(id);
      if (!d) {
        d = { id, label: "Device", open: false, takesCalls: false, dropIn: false, lastSeen: now(), sockets: new Set() };
        devices.set(id, d);
      }
      d.label = clip(m.label, 40) || d.label;
      d.sockets.add(ws);
      d.lastSeen = now();
      pushPresence();
      return;
    }

    const d = s.deviceId && devices.get(s.deviceId);
    if (!d) return; // everything else needs a hello first
    d.lastSeen = now();

    if (m.type === "sign") {
      d.open = m.open === true;
      d.takesCalls = m.takesCalls === true;
      d.dropIn = m.dropIn === true;
      pushPresence();
      if (isReachable(d)) for (const r of rings.values()) if (r.state === "ringing") ringDevice(r, d);
    } else if (m.type === "hb") {
      send(ws, { type: "presence", reachable: reachableDevices().length > 0, devices: summary() });
    } else if (m.type === "ring_answer") {
      answer(String(m.id || ""), d, ws);
    } else if (m.type === "ring_later") {
      later(String(m.id || ""), d);
    }
  }

  // ── rings ──────────────────────────────────────────────────
  const view = (r) => ({
    id: r.id, state: r.state, delivered: r.delivered, topic: r.topic, createdAt: r.createdAt, updatedAt: r.updatedAt,
  });
  function setState(r, state, extra = {}) {
    r.state = state;
    r.updatedAt = new Date(now()).toISOString();
    log({ id: r.id, event: "state", state, ...extra });
  }

  function ringDevice(r, d) {
    if (r.pending.has(d.id) || r.declined.has(d.id)) return;
    r.pending.add(d.id);
    r.delivered = "chime";
    sendDevice(d, {
      type: "ring", id: r.id, topic: r.topic, from: r.from, urgency: r.urgency,
      expiresAt: r.expiresAt, ttlMs: Math.max(0, r.expiresAt - now()),
    });
  }

  function cancelAll(r, exceptDevice) {
    for (const id of r.pending) {
      const d = devices.get(id);
      if (d && d.id !== exceptDevice) sendDevice(d, { type: "ring_cancelled", id: r.id });
    }
  }

  function create(input = {}) {
    const topic = clip(input.topic, 120);
    const brief = clip(input.brief, 2000);
    const from = clip(input.from, 80);
    const urgency = input.urgency === undefined ? "routine" : input.urgency;
    if (!topic) return { status: 400, body: { ok: false, error: "topic required" } };
    if (!URGENCIES.includes(urgency)) return { status: 400, body: { ok: false, error: "urgency must be routine, urgent or critical" } };

    const key = from || "unknown";
    const t = now();
    const stamps = (ringStamps.get(key) || []).filter((x) => t - x < RING_RATE.windowMs);
    if (stamps.length >= RING_RATE.max) {
      log({ event: "rate_limited", from: key, topic });
      return { status: 429, body: { ok: false, error: "too many rings from this caller, try again later" } };
    }
    stamps.push(t);
    ringStamps.set(key, stamps);
    for (const [id, r] of rings) if (t - Date.parse(r.createdAt) > KEEP_MS) rings.delete(id);

    const iso = new Date(t).toISOString();
    const r = {
      id: randomBytes(16).toString("hex"), state: "ringing", delivered: null, topic, brief, from: key === "unknown" ? "" : from,
      urgency, createdAt: iso, updatedAt: iso, expiresAt: t + (timeouts[urgency] || timeouts.routine),
      pending: new Set(), declined: new Set(), timer: null, answeredBy: null, rung: false,
    };
    rings.set(r.id, r);
    log({ id: r.id, event: "created", topic, from: r.from, urgency, brief: brief.slice(0, 300), dryRun });
    start(r).catch((e) => { log({ id: r.id, event: "error", error: String(e?.message || e) }); });
    return { status: 202, body: { id: r.id, state: r.state } };
  }

  async function start(r) {
    if (reachableDevices().length === 0) {
      setState(r, "no_presence");
      return fallback(r, "no_presence");
    }
    if (briefLive) {
      let ok = false;
      try {
        const res = await postJson(`${voiceDumpUrl}/live/ceo/brief`, { ring: r.id, topic: r.topic, text: r.brief, from: r.from });
        ok = !!res?.ok;
      } catch { /* voice-dump down */ }
      // Without the brief the voice would not know why it called, so do not ring the laptop.
      if (!ok) {
        log({ id: r.id, event: "brief_failed" });
        return fallback(r, "brief_failed");
      }
    } else {
      log({ id: r.id, event: "would_send", to: "voice-dump /live/ceo/brief", body: { ring: r.id, topic: r.topic, from: r.from } });
    }
    if (r.state !== "ringing") return;
    for (const d of reachableDevices()) ringDevice(r, d);
    if (r.pending.size === 0) { setState(r, "no_presence"); return fallback(r, "no_presence"); }
    r.rung = true;
    log({ id: r.id, event: "ring_sent", devices: [...r.pending] });
    r.timer = setTimeout(() => {
      if (r.state !== "ringing") return;
      setState(r, "timeout");
      cancelAll(r);
      fallback(r, "timeout");
    }, Math.max(0, r.expiresAt - now()));
    r.timer.unref?.();
  }

  function answer(id, device, ws) {
    const r = rings.get(id);
    if (!r || r.state !== "ringing") { send(ws, { type: "ring_claimed", id }); return; }
    clearTimeout(r.timer);
    r.answeredBy = device.id;
    setState(r, "answered", { device: device.label });
    for (const did of r.pending) { const d = devices.get(did); if (d) sendDevice(d, { type: "ring_claimed", id }, ws); }
    let vdToken = "";
    try { vdToken = readToken(); } catch (e) { log({ id, event: "token_unreadable", error: e.code || "read failed" }); }
    const url = `${embedUrl}?job=ceo&autostart=1&embed=1&ring=${r.id}`;
    send(ws, { type: "ring_go", id: r.id, url, vdToken });
  }

  function later(id, device) {
    const r = rings.get(id);
    if (!r || r.state !== "ringing") return;
    r.pending.delete(device.id);
    r.declined.add(device.id);
    log({ id, event: "later", device: device.label });
    maybeNoOneLeft(r);
  }

  // Declined or disconnected on every device the ring went to: nobody is left to answer.
  function maybeNoOneLeft(r) {
    if (!r.rung) return; // still handing voice-dump the brief
    const left = [...r.pending].filter((id) => { const d = devices.get(id); return d && isReachable(d); });
    if (left.length > 0 || r.state !== "ringing") return;
    clearTimeout(r.timer);
    setState(r, "declined");
    fallback(r, "declined");
  }

  // ── fallback ───────────────────────────────────────────────
  async function fallback(r, reason) {
    const text = telegramText(r);
    const t = now();
    const key = r.topic.toLowerCase();
    let cell = false, cellNote = null;
    if (r.urgency !== "routine") {
      if (isQuietHour(t) && r.urgency !== "critical") cellNote = "quiet_hours";
      else if (t - (cellStamps.get(key) || 0) < CELL_TOPIC_MS) cellNote = "topic_cooldown";
      else cell = true;
    }
    const jobs = [];
    let cellOk = false, tgOk = false;

    if (cell) {
      cellStamps.set(key, t);
      jobs.push((async () => {
        const url = `${voiceDumpUrl}/tw/ring?mode=auto`;
        const body = { instruct: `${r.topic}: ${r.brief}` };
        if (dryRun) { log({ id: r.id, event: "would_send", to: "voice-dump /tw/ring?mode=auto", body }); cellOk = true; return; }
        try {
          const res = await postJson(url, body);
          if (res.status === 409) { cellNote = "already_on_a_call"; return; }
          if (res.ok) cellOk = true; else cellNote = `cell_http_${res.status}`;
        } catch (e) { cellNote = `cell_error_${e?.name || "failed"}`; }
      })());
    }
    jobs.push((async () => {
      if (dryRun) { log({ id: r.id, event: "would_send", to: "telegram", text }); tgOk = true; return; }
      try { await telegram(text); tgOk = true; } catch (e) { log({ id: r.id, event: "telegram_failed", error: String(e?.message || e).slice(0, 200) }); }
    })());
    await Promise.all(jobs);

    r.delivered = cellOk ? "cell" : tgOk ? "telegram" : r.delivered;
    const state = cellOk ? "fallback_cell" : tgOk ? "fallback_telegram" : "fallback_failed";
    setState(r, state, { reason, cellNote, cellOk, tgOk, dryRun });
    pushPresence();
  }

  function get(id) {
    const r = rings.get(String(id));
    return r ? view(r) : null;
  }

  return { attach, create, get, status, startHeartbeat, sweep, devices, rings, isReachable: () => reachableDevices().length > 0 };
}
