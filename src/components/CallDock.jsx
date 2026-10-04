// Docked live call: voice-dump's own /live page in an iframe (it already holds the whole call
// flow), plus a pop-out. The voice-dump token never rides the URL. The page announces itself
// with {type:'vd-ready'} and we answer with {type:'vd-token'} to that exact origin only.
import { useEffect, useRef, useState } from "react";
import { C, BRAND, STATUS } from "../lib/colors";

const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };

const btn = { padding: "5px 10px", fontSize: 12, borderRadius: 8, cursor: "pointer", background: "transparent", color: C.text, border: `1px solid ${C.border}`, fontFamily: "inherit" };

export default function CallDock({ call, onClose }) {
  const [mode, setMode] = useState("dock"); // dock | popped
  const [err, setErr] = useState("");
  const frameRef = useRef(null);
  const popRef = useRef(null);
  const origin = originOf(call.url);
  const token = call.vdToken;

  useEffect(() => {
    const onMsg = (e) => {
      if (!origin || e.origin !== origin) return;
      const fromFrame = frameRef.current && e.source === frameRef.current.contentWindow;
      const fromPop = popRef.current && e.source === popRef.current;
      if (!fromFrame && !fromPop) return;
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "vd-ready") {
        if (token) e.source.postMessage({ type: "vd-token", token }, origin);
        else setErr("No voice token on the server. Paste it once on the voice page.");
      } else if (d.type === "vd-call-state") {
        if (d.state === "ended") { try { popRef.current?.close(); } catch { /* already closed */ } onClose(); }
        else if (d.state === "error") setErr(typeof d.message === "string" && d.message ? d.message.slice(0, 200) : "The call hit an error.");
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [origin, token, onClose]);

  // closing the pop-up window by hand ends the call here too
  useEffect(() => {
    if (mode !== "popped") return undefined;
    const t = setInterval(() => { if (!popRef.current || popRef.current.closed) onClose(); }, 1000);
    return () => clearInterval(t);
  }, [mode, onClose]);

  const popOut = () => {
    const w = window.open(call.url, "rc-call", "popup,width=420,height=680");
    if (!w) { setErr("The browser blocked the pop-up. Allow pop-ups for this page and try again."); return; }
    popRef.current = w;
    setMode("popped"); // unmount the iframe so only one page holds the mic and the voice link
  };
  const hangUp = () => { try { popRef.current?.close(); } catch { /* already closed */ } onClose(); };

  return (
    <div role="dialog" aria-label="Live call" style={{ position: "fixed", right: 12, bottom: 12, zIndex: 80, width: "min(380px, calc(100vw - 24px))", background: C.card, border: `1px solid ${BRAND.border}`, borderRadius: 12, boxShadow: "0 10px 32px rgba(0,0,0,0.55)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS.good, boxShadow: `0 0 6px ${STATUS.good}` }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.bright }}>{mode === "popped" ? "Call is in its own window" : "On a call"}</span>
        {mode === "dock" && <button type="button" onClick={popOut} style={btn}>Pop out</button>}
        <button type="button" onClick={hangUp} style={{ ...btn, color: "#0E0C06", background: STATUS.bad, border: `1px solid ${STATUS.bad}`, fontWeight: 600 }}>Hang up</button>
      </div>
      {err && <div style={{ padding: "8px 10px", fontSize: 12, color: STATUS.warn, borderBottom: `1px solid ${C.border}` }}>{err}</div>}
      {mode === "dock" && (
        <iframe ref={frameRef} src={call.url} title="Live call" allow="microphone; autoplay"
          style={{ border: "none", width: "100%", height: "min(480px, 62vh)", background: C.bg }} />
      )}
    </div>
  );
}
