// Jake's "open sign": a small Open/Closed pill for the header. Open means an agent may ring this
// device with a chime and a pop-up. The click is the user gesture that lets the page ask for
// notification permission and start audio, so it also plays one soft test chime.
import { useEffect, useRef, useState } from "react";
import { C, BRAND, STATUS } from "../lib/colors";
import { usePresence, armAudio, playChime, audioReady } from "../hooks/usePresence";

const notifPerm = () => { try { return "Notification" in window ? Notification.permission : "unsupported"; } catch { return "unsupported"; } };

function Toggle({ on, onChange, disabled, label, hint }) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 6px", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, accentColor: BRAND.accent, width: 16, height: 16 }} />
      <span>
        <span style={{ display: "block", fontSize: 13, color: C.text }}>{label}</span>
        {hint && <span style={{ display: "block", fontSize: 12, color: C.dim, marginTop: 2 }}>{hint}</span>}
      </span>
    </label>
  );
}

export default function OpenSign() {
  const p = usePresence();
  const [menu, setMenu] = useState(false);
  const [perm, setPerm] = useState(notifPerm);
  const [pos, setPos] = useState({ left: 8, top: 40 });
  const boxRef = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [menu]);

  if (!p) return null;
  const { settings, update, connected, reachable } = p;
  const open = settings.open;
  const stuck = open && (!connected || !reachable); // sign is on but the server cannot ring us

  const enable = async () => {
    armAudio();
    p.setSoundOn(audioReady());
    playChime();
    if (notifPerm() === "default") {
      try { await Notification.requestPermission(); } catch { /* old browsers use a callback form, not worth supporting */ }
    }
    setPerm(notifPerm());
  };
  // The menu is fixed-position and clamped into the viewport: on a phone the header wraps and the
  // pill can sit at the left edge, where a menu anchored to its right side would run off screen.
  const toggleMenu = () => {
    const r = boxRef.current?.getBoundingClientRect();
    if (r) {
      const w = Math.min(280, window.innerWidth - 16);
      setPos({ left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)), top: r.bottom + 6 });
    }
    setMenu((m) => !m);
  };
  const toggle = () => {
    const next = !open;
    update({ open: next });
    if (next) enable();
  };

  const dot = !open ? C.dim : stuck ? STATUS.warn : STATUS.good;
  const title = !open ? "Sign is closed. Click to open it so agents can ring you here."
    : !connected ? "Open, but this page lost its connection to the server. Reconnecting."
      : !reachable ? "Open, but the server can't reach this device. Check \"Take calls on this device\" in the menu."
        : "Open. Agents can ring you here.";

  const half = { height: 28, background: open ? C.card : "transparent", color: open ? BRAND.focus : C.dim, cursor: "pointer", fontSize: 13, lineHeight: 1, fontFamily: "inherit" };
  return (
    <div ref={boxRef} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <div style={{ display: "inline-flex", width: 96, border: `1px solid ${open ? BRAND.border : C.border}`, borderRadius: 999, overflow: "hidden" }}>
        <button type="button" onClick={toggle} title={title} aria-pressed={open} aria-label={open ? "Sign is open. Close it." : "Sign is closed. Open it."}
          style={{ ...half, flex: 1, border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontWeight: 600, padding: "0 4px 0 10px" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, boxShadow: open && !stuck ? `0 0 6px ${dot}` : "none", flexShrink: 0 }} />
          {open ? "Open" : "Closed"}
        </button>
        <button type="button" onClick={toggleMenu} aria-label="Sign settings" aria-expanded={menu}
          style={{ ...half, width: 24, border: "none", borderLeft: `1px solid ${C.border}`, padding: 0 }}>
          <span style={{ fontSize: 10 }}>▾</span>
        </button>
      </div>

      {menu && (
        <div role="dialog" aria-label="Sign settings" style={{ position: "fixed", left: pos.left, top: pos.top, width: 280, maxWidth: "calc(100vw - 16px)", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, zIndex: 60, boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}>
          <div style={{ padding: "6px 6px 2px", fontSize: 12, color: stuck ? STATUS.warn : C.dim }}>
            {!open ? "Sign is closed. Agents will message you on Telegram."
              : !connected ? "Open, but this page is offline. Reconnecting."
                : !reachable ? "Open, but not reachable. Turn on \"Take calls\" below."
                  : "Open. Agents can ring this device."}
          </div>
          <Toggle on={settings.takesCalls} onChange={(v) => update({ takesCalls: v })} label="Take calls on this device"
            hint={p.me.label === "Phone" ? "Off by default on a phone so it never competes with the laptop." : undefined} />
          <Toggle on={settings.dropIn} disabled={!settings.takesCalls} onChange={(v) => update({ dropIn: v })} label="Drop in (urgent only)"
            hint="Urgent rings connect after 3 seconds if you were just here. Off by default." />
          {perm === "denied" && (
            <div style={{ padding: "6px 6px", fontSize: 12, color: STATUS.warn }}>
              Notifications are blocked. Click the lock icon next to the address, then allow Notifications. The chime and banner still work.
            </div>
          )}
          {perm === "default" && (
            <button type="button" onClick={enable} style={{ margin: "4px 6px", padding: "6px 10px", fontSize: 12, color: C.text, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer" }}>
              Turn on pop-up notifications
            </button>
          )}
          {open && !p.soundOn && (
            <div style={{ padding: "6px 6px", fontSize: 12, color: C.dim }}>Sound is off until you click anywhere on this page once.</div>
          )}
          {p.notice && <div style={{ padding: "6px 6px", fontSize: 12, color: C.dim }}>{p.notice}</div>}
          <div style={{ padding: "6px 6px 2px", fontSize: 11, color: C.dim }}>
            Windows Focus Assist can hide the pop-up. The chime and the banner in this page still show.
          </div>
        </div>
      )}
    </div>
  );
}
