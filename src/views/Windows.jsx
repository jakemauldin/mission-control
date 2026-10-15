// Windows (/windows, Jake 2026-10-14): the desktops and dashboards he keeps open all day, as live windows on one
// page. Kasm 1 and 2 are live KasmVNC frames you can click into and work, App Builds renders the Apps view in
// place, and anything that refuses to be framed (OpenClaw's control UI) is a tile that opens it in its own tab
// with the reason on it. The page only looks: closing it, or pausing a window, closes nothing on the other side.
//
// GET /api/windows (server/lib/windows.js) says, per window, whether it is up and whether a browser will frame
// it, probed from this host. Focus fills the page with one window without remounting it, so a VNC session stays
// connected; ?focus=<id> in the URL keeps that across a reload and makes one window bookmarkable. Paused windows
// are remembered per browser (localStorage) because a live VNC frame costs the box a stream.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { C, BRAND, STATUS } from "../lib/colors";
import { btnS } from "../lib/helpers";
import { useOnFocus } from "../hooks/useOnFocus";
import AppBuildsView from "./AppBuilds";
import SessionsView from "./Sessions";
import ProjectsView from "./Projects";

// Mission Control pages that render in place instead of loading the whole app again in a frame.
const LOCAL = { "/apps": AppBuildsView, "/sessions": SessionsView, "/projects": ProjectsView };
const LS_PAUSED = "mc-windows-paused";
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

// Jake's browser reaches the tailnet services on the hostname it reached Mission Control on. A test copy on
// localhost falls back to the tailnet name the server probes.
function hrefFor(w, host) {
  if (w.local) return w.local;
  if (w.port) {
    const h = location.hostname.endsWith(".ts.net") ? location.hostname : host;
    return `https://${h}:${w.port}${w.path || "/"}`;
  }
  return w.url;
}

function dotFor(check) {
  if (!check) return { color: C.dim, text: "not checked yet" };
  if (!check.up) return { color: STATUS.bad, text: check.reason || "down" };
  if (check.signIn) return { color: STATUS.good, text: "up, asks for a password" };
  return { color: STATUS.good, text: check.ms ? `up, answered in ${check.ms} ms` : "up" };
}

const iconBtn = { ...btnS(false), padding: "5px 10px", fontSize: 12, textDecoration: "none", display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" };

function Tile({ w, host, focused, paused, onFocus, onPause, onHide }) {
  const [nonce, setNonce] = useState(0);
  const check = w.check;
  const dot = dotFor(check);
  const href = hrefFor(w, host);
  const Local = w.local ? LOCAL[w.local] : null;
  const live = !Local && check?.frameable && check?.up;
  const blocked = !Local && check && (!check.frameable || !check.up);

  // Focus restyles this same element (no remount, so a VNC session stays connected).
  const shell = focused
    ? { position: "fixed", inset: 8, zIndex: 60, display: "flex", flexDirection: "column", background: C.card, border: `1px solid ${BRAND.border}`, borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.55)" }
    : { display: "flex", flexDirection: "column", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, minWidth: 0, overflow: "hidden" };
  const body = focused ? { flex: 1, minHeight: 0 } : { aspectRatio: w.kind === "local" ? undefined : "16 / 10", height: w.kind === "local" ? 460 : undefined };

  return (
    <section style={shell} aria-label={w.title}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "8px 10px", borderBottom: `1px solid ${C.border}`, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 200px", minWidth: 0 }}>
        <span title={dot.text} aria-label={dot.text} style={{ width: 9, height: 9, borderRadius: "50%", background: dot.color, flex: "none" }} />
        <button onClick={() => onFocus(focused ? null : w.id)} title={focused ? "Back to all windows" : "Fill the page with this window"}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.bright, fontWeight: 700, fontSize: 14, fontFamily: "inherit", flex: "none" }}>
          {w.title}
        </button>
        <span style={{ color: C.dim, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }} title={w.note}>{w.note}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
        {live && <button style={iconBtn} onClick={() => onPause(w.id, !paused)} title={paused ? "Connect this window" : "Disconnect this window to save the stream; nothing on the other side stops"}>{paused ? "Connect" : "Pause"}</button>}
        {live && !paused && <button style={iconBtn} onClick={() => setNonce((n) => n + 1)} title="Reload this window">Reload</button>}
        <button style={iconBtn} onClick={() => onFocus(focused ? null : w.id)}>{focused ? "Back" : "Focus"}</button>
        <a style={iconBtn} href={href} target="_blank" rel="noopener noreferrer" title="Open in its own tab">Tab ↗</a>
        {!focused && <button style={iconBtn} onClick={() => onHide(w.id)} title="Hide from this page (Show hidden brings it back)">Hide</button>}
        </div>
      </div>

      <div style={{ ...body, position: "relative", background: C.bg }}>
        {Local && <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: 12 }}><Local /></div>}

        {live && !paused && (
          <iframe key={nonce} src={href} title={w.title} loading="lazy"
            allow="clipboard-read; clipboard-write; fullscreen; autoplay"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "#000" }} />
        )}

        {live && paused && (
          <Centered>
            <div style={{ color: C.dim, fontSize: 13, marginBottom: 10 }}>Paused here. {w.title} is still running.</div>
            <button style={btnS(true)} onClick={() => onPause(w.id, false)}>Connect</button>
          </Centered>
        )}

        {blocked && (
          <Centered>
            <div style={{ color: C.bright, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{w.title}</div>
            <div style={{ color: dot.color, fontSize: 13, marginBottom: 8 }}>{check.up ? dot.text : "down"}</div>
            {check.reason && <div style={{ color: C.dim, fontSize: 13, maxWidth: 460, lineHeight: 1.45, marginBottom: 14 }}>{check.up ? `Opens in its own tab. ${check.reason}` : check.reason}</div>}
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ ...btnS(true), fontSize: 13, padding: "8px 18px", textDecoration: "none" }}>Open {w.title} ↗</a>
          </Centered>
        )}

        {!Local && !check && <Centered><div style={{ color: C.dim, fontSize: 13 }}>Checking…</div></Centered>}
      </div>

      {live && check?.signIn && !paused && !focused && (
        <div style={{ padding: "6px 10px", fontSize: 11.5, color: C.dim, borderTop: `1px solid ${C.border}` }}>
          Blank or "401"? <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: BRAND.link }}>Sign in once in a tab</a> (kasm_user), then Reload.
        </div>
      )}
    </section>
  );
}

const Centered = ({ children }) => (
  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 18 }}>{children}</div>
);

function AddWindow({ onDone }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = { background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", fontSize: 13, fontFamily: "inherit", minWidth: 0 };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/windows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, url, note }) })
      .then((x) => x.json()).catch((x) => ({ ok: false, error: x.message }));
    setBusy(false);
    if (!r.ok) return setErr(r.error || "could not save");
    onDone(true);
  };
  return (
    <form onSubmit={save} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <input style={{ ...input, flex: "1 1 140px" }} placeholder="Name" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Name" />
      <input style={{ ...input, flex: "3 1 260px" }} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Address" />
      <input style={{ ...input, flex: "2 1 180px" }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      <button type="submit" disabled={busy} style={{ ...btnS(true), fontSize: 13, padding: "7px 16px" }}>{busy ? "Saving…" : "Add"}</button>
      <button type="button" onClick={() => onDone(false)} style={{ ...btnS(false), fontSize: 13, padding: "7px 14px" }}>Cancel</button>
      {err && <div style={{ color: STATUS.bad, fontSize: 12, flexBasis: "100%" }}>{err}</div>}
      <div style={{ color: C.dim, fontSize: 11.5, flexBasis: "100%" }}>Sites that refuse to be framed (most outside apps: JobTread, Gmail, QuickBooks, claude.ai) show as a tile that opens them in their own tab.</div>
    </form>
  );
}

export default function WindowsView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [paused, setPaused] = useState(() => new Set(lsGet(LS_PAUSED) || []));
  const [sp, setSp] = useSearchParams();
  const focus = sp.get("focus");

  const load = useCallback((fresh) => {
    fetch(`/api/windows${fresh ? "?fresh=1" : ""}`).then((r) => r.json())
      .then((j) => { if (j.ok) { setData(j.data); setError(null); } else setError(j.error || "could not load"); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(false); const t = setInterval(() => load(false), 60_000); return () => clearInterval(t); }, [load]);
  useOnFocus(() => load(false));

  const setFocus = useCallback((id) => {
    const next = new URLSearchParams(sp);
    if (id) next.set("focus", id); else next.delete("focus");
    setSp(next, { replace: true });
  }, [sp, setSp]);

  useEffect(() => {
    if (!focus) return;
    const onKey = (e) => { if (e.key === "Escape") setFocus(null); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [focus, setFocus]);

  const onPause = useCallback((id, on) => {
    setPaused((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); lsSet(LS_PAUSED, [...n]); return n; });
  }, []);
  const onHide = useCallback(async (id, hidden = true) => {
    await fetch(`/api/windows/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hidden }) }).catch(() => {});
    if (focus === id) setFocus(null);
    load(false);
  }, [focus, setFocus, load]);
  const onRemove = useCallback(async (id) => {
    await fetch(`/api/windows/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    load(false);
  }, [load]);

  const windows = useMemo(() => data?.windows || [], [data]);
  const shown = windows.filter((w) => !w.hidden);
  const hidden = windows.filter((w) => w.hidden);
  const upCount = shown.filter((w) => w.check?.up).length;
  const checked = data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.bright, margin: 0 }}>Windows</h1>
        <span style={{ color: C.dim, fontSize: 13, flex: "1 1 260px" }}>
          Click into any window to work in it. Closing this tab or pausing a window leaves everything behind it running.
        </span>
        <span style={{ color: C.dim, fontSize: 12 }}>
          {data ? `${upCount} of ${shown.length} up` : "checking…"}{checked ? `, checked ${checked}` : ""}
        </span>
        <button style={btnS(false)} onClick={() => load(true)}>Check now</button>
        {!adding && <button style={btnS(false)} onClick={() => setAdding(true)}>Add a window</button>}
        {hidden.length > 0 && <button style={btnS(false)} onClick={() => setShowHidden((v) => !v)}>{showHidden ? "Done" : `Show hidden (${hidden.length})`}</button>}
      </div>

      {error && <div style={{ color: STATUS.bad, fontSize: 13, marginBottom: 10 }}>Could not load the window list: {error}</div>}
      {adding && <AddWindow onDone={(saved) => { setAdding(false); if (saved) load(true); }} />}

      {showHidden && hidden.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {hidden.map((w) => (
            <span key={w.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 6px 4px 10px", fontSize: 13 }}>
              {w.title}
              <button style={btnS(false)} onClick={() => onHide(w.id, false)}>Show</button>
              {!w.builtIn && <button style={btnS(false)} onClick={() => onRemove(w.id)}>Remove</button>}
            </span>
          ))}
        </div>
      )}

      <div className="rc-windows">
        {shown.map((w) => (
          <Tile key={w.id} w={w} host={data?.host} focused={focus === w.id} paused={paused.has(w.id)}
            onFocus={setFocus} onPause={onPause} onHide={onHide} />
        ))}
      </div>
      {focus && <div onClick={() => setFocus(null)} style={{ position: "fixed", inset: 0, zIndex: 55, background: "rgba(10,11,18,0.7)" }} aria-hidden="true" />}
    </div>
  );
}
