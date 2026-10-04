// Open sign presence: one socket per tab on /ws that tells the server "this device is open and
// takes calls", receives rings, and hands the answer back (server/lib/ring.js).
// Mount <PresenceProvider> once around the shell. OpenSign and RingLayer read it with usePresence().
//
// Only the "leader" tab of a browser profile chimes and shows the pop-up (navigator.locks), so
// two dashboard tabs do not ring twice. Without Web Locks every tab acts as leader.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const LS_DEVICE = "rc-device-id";
const LS_SIGN = "rc-sign";
const ACTIVE_WINDOW_MS = 5 * 60_000;

// localStorage can throw (private window, blocked site data), so every touch is wrapped.
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered, still works */ } };

const isPhone = () => /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || "");
const guessLabel = () => (isPhone() ? "Phone" : "Laptop");

function deviceId() {
  let id = lsGet(LS_DEVICE);
  if (!id) {
    id = (globalThis.crypto?.randomUUID?.() || `d-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`).replace(/[^\w-]/g, "");
    lsSet(LS_DEVICE, id);
  }
  return id;
}

// Phone defaults to not taking calls so it never competes with the laptop.
function readSettings() {
  const base = { open: false, takesCalls: !isPhone(), dropIn: false };
  try { return { ...base, ...JSON.parse(lsGet(LS_SIGN) || "{}") }; } catch { return base; }
}

// ── sound ────────────────────────────────────────────────────
// Browsers only let audio start after a gesture on the page. armAudio() runs from the sign click
// (and the first click anywhere after a reload), so a ring that arrives later can chime.
let actx = null;
export function armAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!actx) actx = new AC();
    if (actx.state === "suspended") actx.resume();
    return actx.state === "running" || actx.state === "suspended";
  } catch { return false; }
}
export const audioReady = () => !!actx && actx.state === "running";

// Soft two-note chime at low gain. Returns false when the browser still blocks audio.
export function playChime() {
  if (!audioReady()) return false;
  const t0 = actx.currentTime;
  [[659.25, 0], [880, 0.2]].forEach(([freq, at]) => {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45);
    o.connect(g).connect(actx.destination);
    o.start(t0 + at);
    o.stop(t0 + at + 0.5);
  });
  return true;
}

const PresenceCtx = createContext(null);
export const usePresence = () => useContext(PresenceCtx);

export function PresenceProvider({ children }) {
  const [settings, setSettings] = useState(readSettings);
  const [connected, setConnected] = useState(false);
  const [reachable, setReachable] = useState(false);
  const [devices, setDevices] = useState([]);
  const [isLeader, setIsLeader] = useState(() => !navigator.locks?.request);
  const [ring, setRing] = useState(null);       // {id, topic, from, urgency, expiresAt}
  const [call, setCall] = useState(null);       // {id, url, vdToken}
  const [notice, setNotice] = useState("");
  const [soundOn, setSoundOn] = useState(audioReady());
  const wsRef = useRef(null);
  const settingsRef = useRef(settings);
  const lastActive = useRef(Date.now());
  const me = useMemo(() => ({ id: deviceId(), label: guessLabel() }), []);

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const send = useCallback((m) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
  }, []);
  const announce = useCallback(() => {
    const s = settingsRef.current;
    send({ type: "sign", open: s.open, takesCalls: s.takesCalls, dropIn: s.dropIn });
  }, [send]);

  // socket: same URL logic as useWebSocket, backoff capped at 30 s, hello + sign on every connect
  useEffect(() => {
    let closed = false, retries = 0, timer = null;
    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      let ws;
      try { ws = new WebSocket(`${protocol}//${location.host}/ws`); } catch { return; }
      wsRef.current = ws;
      ws.onopen = () => {
        retries = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: "hello", deviceId: me.id, label: me.label }));
        announce();
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "presence") { setReachable(!!m.reachable); setDevices(m.devices || []); }
        else if (m.type === "ring") {
          // ttlMs is relative so a skewed laptop clock cannot shorten or stretch the countdown
          const expiresAt = typeof m.ttlMs === "number" ? Date.now() + m.ttlMs : m.expiresAt;
          setRing({ id: m.id, topic: m.topic, from: m.from, urgency: m.urgency, expiresAt });
        } else if (m.type === "ring_claimed" || m.type === "ring_cancelled") {
          setRing((r) => (r && r.id === m.id ? null : r));
        } else if (m.type === "ring_go") {
          setRing((r) => (r && r.id === m.id ? null : r));
          setCall({ id: m.id, url: m.url, vdToken: m.vdToken || "" });
        }
      };
      ws.onclose = () => {
        setConnected(false);
        setReachable(false);
        if (closed) return;
        timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retries++));
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { closed = true; clearTimeout(timer); const ws = wsRef.current; if (ws) { ws.onclose = null; ws.close(); } };
  }, [me, announce]);

  // a ring that nobody cancelled still ends: drop it a moment after it expires
  useEffect(() => {
    if (!ring) return undefined;
    const t = setTimeout(() => setRing((r) => (r && r.id === ring.id ? null : r)), Math.max(0, ring.expiresAt - Date.now()) + 1500);
    return () => clearTimeout(t);
  }, [ring]);

  // heartbeat only on visibility/focus. The server pings on its own, so throttled background
  // timers do not matter, but a tab coming back should refresh what it believes.
  useEffect(() => {
    const hb = () => { if (document.visibilityState !== "hidden") send({ type: "hb" }); };
    const act = () => { lastActive.current = Date.now(); };
    document.addEventListener("visibilitychange", hb);
    window.addEventListener("focus", hb);
    ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"].forEach((e) => window.addEventListener(e, act, { passive: true }));
    const arm = () => { armAudio(); setSoundOn(audioReady()); };
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      document.removeEventListener("visibilitychange", hb);
      window.removeEventListener("focus", hb);
      ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"].forEach((e) => window.removeEventListener(e, act));
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [send]);

  // other tabs of this browser change the same sign settings
  useEffect(() => {
    const onStorage = (e) => { if (e.key === LS_SIGN) setSettings(readSettings()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // leader election: the lock is held until this tab closes, then the next tab inherits it
  useEffect(() => {
    if (!navigator.locks?.request) return undefined;
    const ctl = new AbortController();
    navigator.locks.request("rc-ring-leader", { signal: ctl.signal }, () => {
      setIsLeader(true);
      return new Promise(() => {});
    }).catch(() => {});
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    if (document.wasDiscarded) setNotice("This tab was put to sleep by the browser and reloaded. Keep the dashboard in its own window so it stays awake.");
  }, []);

  const update = useCallback((patch) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    lsSet(LS_SIGN, JSON.stringify(next));
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "sign", open: next.open, takesCalls: next.takesCalls, dropIn: next.dropIn }));
  }, []);

  const answer = useCallback((id) => send({ type: "ring_answer", id }), [send]);
  const later = useCallback((id) => { send({ type: "ring_later", id }); setRing((r) => (r && r.id === id ? null : r)); }, [send]);
  const endCall = useCallback(() => setCall(null), []);
  const idleMs = useCallback(() => Date.now() - lastActive.current, []);

  const value = useMemo(() => ({
    me, settings, update, connected, reachable, devices, isLeader, ring, call, notice,
    answer, later, endCall, idleMs, activeWindowMs: ACTIVE_WINDOW_MS, soundOn, setSoundOn,
  }), [me, settings, update, connected, reachable, devices, isLeader, ring, call, notice, answer, later, endCall, idleMs, soundOn]);

  return createElement(PresenceCtx.Provider, { value }, children);
}
