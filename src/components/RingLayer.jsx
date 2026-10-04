// Shows an incoming ring (banner, soft chime, system notification) and, after Answer, the call
// dock. Mount once, globally, inside <PresenceProvider>. Only the leader tab of this browser acts,
// so two open tabs do not ring twice.
import { useEffect, useRef, useState } from "react";
import { C, BRAND, STATUS } from "../lib/colors";
import { usePresence, armAudio, playChime } from "../hooks/usePresence";
import CallDock from "./CallDock";

const DROP_IN_MS = 3000;
const CHIME_EVERY_MS = 6000;

function Banner({ ring, p }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((ring.expiresAt - Date.now()) / 1000)));
  const [dropLeft, setDropLeft] = useState(null); // seconds until auto-answer, null when not dropping in
  const cancelled = useRef(false);
  const total = useRef(Math.max(1, ring.expiresAt - Date.now()));

  // countdown
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((ring.expiresAt - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, [ring.expiresAt]);

  // chime now and every 6 s until this banner goes away (answered, claimed, cancelled, expired)
  useEffect(() => {
    playChime();
    const t = setInterval(playChime, CHIME_EVERY_MS);
    return () => clearInterval(t);
  }, [ring.id]);

  // system notification: silent because the page plays its own chime
  useEffect(() => {
    let n = null;
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        n = new Notification(ring.topic, { body: ring.from ? `${ring.from} wants to talk` : "Someone wants to talk", tag: ring.id, requireInteraction: true, silent: true });
        n.onclick = () => { window.focus(); n.close(); };
      }
    } catch { /* some browsers only allow notifications from a service worker */ }
    return () => { try { n?.close(); } catch { /* already gone */ } };
  }, [ring.id, ring.topic, ring.from]);

  // drop-in: urgent or critical only, device toggle on, and Jake was at the keyboard in the last 5 min
  const s = p.settings;
  const eligible = (ring.urgency === "urgent" || ring.urgency === "critical") && s.dropIn && s.takesCalls && p.idleMs() < p.activeWindowMs;
  useEffect(() => {
    if (!eligible || cancelled.current) return undefined;
    const end = Date.now() + DROP_IN_MS;
    const tick = () => setDropLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    tick();
    const iv = setInterval(tick, 250);
    const to = setTimeout(() => { if (!cancelled.current) p.answer(ring.id); }, DROP_IN_MS);
    return () => { clearInterval(iv); clearTimeout(to); };
  // eligible is decided once per ring; re-running on every settings tick would restart the 3 s
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring.id, eligible]);

  const cancelDrop = () => { cancelled.current = true; setDropLeft(null); };
  const answer = () => { armAudio(); cancelled.current = true; p.answer(ring.id); };
  const tone = ring.urgency === "critical" ? STATUS.bad : ring.urgency === "urgent" ? STATUS.warn : BRAND.accent;
  const pct = Math.max(0, Math.min(100, ((left * 1000) / total.current) * 100));

  return (
    <div role="alertdialog" aria-label="Incoming call" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 90, width: "min(440px, calc(100vw - 24px))", background: C.card, border: `1px solid ${tone}`, borderRadius: 12, boxShadow: "0 10px 32px rgba(0,0,0,0.55)", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.dim }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: tone, boxShadow: `0 0 8px ${tone}` }} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ring.from ? `${ring.from} wants to talk` : "Someone wants to talk"}</span>
          {ring.urgency !== "routine" && <span style={{ color: tone, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 11 }}>{ring.urgency}</span>}
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{left}s</span>
        </div>
        <div style={{ margin: "6px 0 12px", fontSize: 16, fontWeight: 600, color: C.bright, overflowWrap: "anywhere" }}>{ring.topic}</div>
        {dropLeft !== null ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, fontSize: 13, color: C.text }}>Connecting in {dropLeft}...</span>
            <button type="button" onClick={cancelDrop} style={{ padding: "8px 16px", borderRadius: 8, background: "transparent", color: C.text, border: `1px solid ${C.border}`, cursor: "pointer", fontSize: 14 }}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={answer} autoFocus style={{ flex: 1, padding: "9px 16px", borderRadius: 8, background: BRAND.accent, color: "#0E0C06", border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Answer</button>
            <button type="button" onClick={() => p.later(ring.id)} style={{ padding: "9px 16px", borderRadius: 8, background: "transparent", color: C.text, border: `1px solid ${C.border}`, fontSize: 14, cursor: "pointer" }}>Later</button>
          </div>
        )}
      </div>
      <div style={{ height: 3, background: C.border }}><div style={{ height: 3, width: `${pct}%`, background: tone, transition: "width 250ms linear" }} /></div>
    </div>
  );
}

export default function RingLayer() {
  const p = usePresence();
  if (!p || !p.isLeader) return null;
  return (
    <>
      {p.ring && !p.call && <Banner key={p.ring.id} ring={p.ring} p={p} />}
      {p.call && <CallDock key={p.call.id} call={p.call} onClose={p.endCall} />}
    </>
  );
}
