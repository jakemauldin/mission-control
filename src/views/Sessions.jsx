// Sessions (2026-08-23): the buttons behind Telegram /sessions, /revive, /stop, /park.
// A Claude Code session is a saved conversation plus a restartable process on the VPS.
// "off" here means the process is gone (the phone shows it as Disconnected). Revive starts
// it again under the risingcreek-ai device, phone-reachable with full history, no desktop
// needed. That is why idle ones can be parked. Settings are shared with the script
// (~/services/config/sessions.json) and the auto-park timer lives in the dashboard server.
import { useState, useEffect, useCallback } from "react";
import { C, STATUS } from "../lib/colors";
import { btnS } from "../lib/helpers";
import { Section } from "../components/ui/Card";
import { useWebSocket } from "../hooks/useWebSocket";

const HOW = { desktop: "desktop app", device: "phone device", revived: "revived" };

function ago(iso) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

function Dot({ live }) {
  return <span style={{ width: 8, height: 8, borderRadius: "50%", background: live ? STATUS.good : C.dim, flexShrink: 0, display: "inline-block" }} />;
}

const inputS = {
  fontSize: 13, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
  background: C.bg, color: C.text, fontFamily: "inherit", width: 90,
};

function proj(cwd) {
  if (!cwd) return "";
  const p = cwd.replace(/^\/home\/risingcreek\//, "~/");
  if (/mission-control/.test(p)) return "mission-control";
  if (p === "~/services") return "services";
  if (p.startsWith("~/services/.claude/worktrees/")) return "services wt";
  if (p.startsWith("~/services/")) return p.split("/")[1];
  return p.replace("~/", "");
}

function SessionRow({ s, busy, onAction }) {
  const live = s.state === "live";
  const isDevice = s.how === "device";
  const working = busy === s.uuid;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
      <Dot live={live} />
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.bright, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {s.pinned ? "📌 " : ""}{s.title}
        </div>
        <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono }}>
          {live ? `live · ${HOW[s.how] || s.how}` : "off"} · {ago(s.lastActivity)} ago · {s.sizeKB >= 1024 ? `${(s.sizeKB / 1024).toFixed(1)} MB` : `${s.sizeKB} KB`}{proj(s.cwd) ? ` · ${proj(s.cwd)}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {!live && (
          <button style={btnS(true)} disabled={!!busy} onClick={() => onAction(s, "revive")}>
            {working ? "Reviving…" : "Revive"}
          </button>
        )}
        {live && !isDevice && (
          <button style={btnS(false)} disabled={!!busy} onClick={() => onAction(s, "stop")}>
            {working ? "Stopping…" : "Stop"}
          </button>
        )}
        {live && isDevice && <span style={{ fontSize: 11, color: C.dim, alignSelf: "center" }}>managed by the device</span>}
        <button style={btnS(false)} disabled={!!busy} title={s.pinned ? "Park may stop this again" : "Park will never stop this"}
          onClick={() => onAction(s, s.pinned ? "unpin" : "pin")}>
          {s.pinned ? "Unpin" : "Pin"}
        </button>
      </div>
    </div>
  );
}

function SettingsCard({ settings, onSave }) {
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setForm(settings); }, [settings]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => { await onSave(form); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  const label = { fontSize: 12, color: C.text, display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", maxWidth: 420 };
  return (
    <Section title="Settings">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={label}>
          <span>
            <span style={{ fontWeight: 600, color: C.bright }}>Auto-park idle sessions</span>
            <span style={{ display: "block", color: C.dim, fontSize: 11 }}>Checked every 15 min by the dashboard. Never touches pinned sessions or the phone device's own sessions.</span>
          </span>
          <input type="checkbox" checked={!!form.autoPark} onChange={(e) => set("autoPark", e.target.checked)} style={{ width: 18, height: 18 }} />
        </label>
        <label style={label}>
          <span>Idle threshold (hours)<span style={{ display: "block", color: C.dim, fontSize: 11 }}>No activity this long = parked. Revive brings it back any time.</span></span>
          <input type="number" min="0.5" step="0.5" value={form.parkHours} onChange={(e) => set("parkHours", e.target.value)} style={inputS} />
        </label>
        <label style={label}>
          <span>Compact on revive above (KB)<span style={{ display: "block", color: C.dim, fontSize: 11 }}>Big transcripts get /compact first so each phone turn stays cheap.</span></span>
          <input type="number" min="100" step="50" value={form.compactKB} onChange={(e) => set("compactKB", e.target.value)} style={inputS} />
        </label>
        <label style={label}>
          <span>Sessions shown</span>
          <input type="number" min="5" max="60" value={form.listCount} onChange={(e) => set("listCount", e.target.value)} style={inputS} />
        </label>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button style={btnS(true)} onClick={save}>Save</button>
          {saved && <span style={{ fontSize: 12, color: STATUS.good }}>Saved</span>}
        </div>
      </div>
    </Section>
  );
}

export default function SessionsView() {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const [parkPreview, setParkPreview] = useState(null);
  const [q, setQ] = useState("");
  const [stateF, setStateF] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const { lastMessage } = useWebSocket();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/sessions");
      if (r.status === 401) { setErr("session expired"); return; }
      const body = await r.json();
      if (!body.ok) throw new Error(body.message || `HTTP ${r.status}`);
      setData(body.data);
      setSettings(body.settings);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (lastMessage?.type === "sessions_update") {
      if (lastMessage.parked) setNote(lastMessage.parked);
      load();
    }
  }, [lastMessage, load]);

  const act = async (s, action) => {
    setBusy(s.uuid);
    setNote(action === "revive" ? `Reviving ${s.title}… about 10 seconds, longer if it needs compacting.` : null);
    try {
      const r = await fetch(`/api/sessions/${s.uuid}/${action}`, { method: "POST" });
      const body = await r.json();
      setNote(body.message || (body.ok ? "Done" : "Failed"));
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(null);
      load();
    }
  };

  const park = async (apply) => {
    setBusy("park");
    try {
      const r = await fetch("/api/sessions/park", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply }) });
      const body = await r.json();
      if (apply) { setParkPreview(null); setNote(body.message); } else setParkPreview(body.message);
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(null);
      load();
    }
  };

  const saveSettings = async (form) => {
    const r = await fetch("/api/sessions/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const body = await r.json();
    if (body.ok) setSettings(body.data);
  };

  if (err) return <Section title="Sessions"><div style={{ color: C.dim }}>{err}</div></Section>;
  if (!data) return <Section title="Sessions"><div style={{ color: C.dim }}>Loading…</div></Section>;

  const live = data.filter((s) => s.state === "live").length;
  const wouldPark = parkPreview && !/^Nothing idle/.test(parkPreview);
  // Search across EVERYTHING the server sent (all projects since 8/23), then trim to the
  // "Sessions shown" setting only when no search/filter is active.
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = data.filter((s) => {
    if (stateF !== "all" && s.state !== stateF) return false;
    const hay = `${s.title} ${s.cwd || ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const filtering = words.length > 0 || stateF !== "all";
  const shown = filtering || showAll ? matches : matches.slice(0, Number(settings?.listCount) || 15);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Sessions">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: C.dim }}>{live} live · {data.length - live} off. Off means the process is gone (Disconnected on the phone). Revive brings it back under the risingcreek-ai device.</span>
          <span style={{ flex: 1 }} />
          <button style={btnS(false)} disabled={!!busy} onClick={() => park(false)}>{busy === "park" ? "Checking…" : "Park idle now"}</button>
          <button style={btnS(false)} onClick={load}>Refresh</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all sessions… (name or folder)"
            style={{ ...inputS, width: 240, flex: "0 1 260px" }} />
          {["all", "live", "stopped"].map((f) => (
            <button key={f} onClick={() => setStateF(f)}
              style={{ ...btnS(stateF === f), textTransform: "capitalize" }}>{f === "stopped" ? "Off" : f}</button>
          ))}
          <span style={{ fontSize: 11, color: C.dim }}>
            showing {shown.length} of {data.length}
          </span>
          {!filtering && data.length > shown.length && <button style={btnS(false)} onClick={() => setShowAll(true)}>Show all {data.length}</button>}
          {!filtering && showAll && <button style={btnS(false)} onClick={() => setShowAll(false)}>Show fewer</button>}
        </div>
        {note && <div style={{ fontSize: 12, color: C.text, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8, marginBottom: 6, whiteSpace: "pre-wrap" }}>{note}</div>}
        {parkPreview && (
          <div style={{ fontSize: 12, color: C.text, padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6, whiteSpace: "pre-wrap" }}>
            {parkPreview}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {wouldPark && <button style={btnS(true)} disabled={!!busy} onClick={() => park(true)}>Stop these</button>}
              <button style={btnS(false)} onClick={() => setParkPreview(null)}>Close</button>
            </div>
          </div>
        )}
        {shown.length === 0 ? (
          <div style={{ color: C.dim, fontSize: 13 }}>{data.length === 0 ? "No sessions found" : `Nothing matches "${q}"`}</div>
        ) : (
          shown.map((s) => <SessionRow key={s.uuid} s={s} busy={busy} onAction={act} />)
        )}
      </Section>
      {settings && <SettingsCard settings={settings} onSave={saveSettings} />}
    </div>
  );
}
