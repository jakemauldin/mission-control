import { useCallback, useEffect, useMemo, useState } from "react";
import { C, inn } from "../lib/colors";
import { badge } from "../lib/helpers";
import { Section } from "../components/ui/Card";

// Projects — per-project running to-do with progress dates (Jake, 2026-08-16).
// Data: GET /api/projects (IN-FLIGHT.md headings + plate table, merged with
// ~/services/projects/projects.json). To-dos on manual projects are editable here;
// rows that come from the IN-FLIGHT table are read-only (edit IN-FLIGHT.md).

const STATE_COLOR = { active: "#2A9D8F", partial: "#E8B22A", waiting: "#60A5FA", blocked: "#EF4444", done: "#94A3B8", note: "#64748B", info: "#64748B", paused: "#64748B" };
const STATE_LABEL = { active: "Active", partial: "Partial", waiting: "Waiting", blocked: "Open / blocked", done: "Done", note: "Note", info: "Info", paused: "Paused" };
const OPEN_STATES = new Set(["active", "partial", "waiting", "blocked"]);

const fmtDate = (d) => {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const dt = new Date(s + (s.length === 10 ? "T12:00:00" : ""));
  if (isNaN(dt)) return s;
  const days = Math.round((Date.now() - dt.getTime()) / 86400000);
  const rel = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
  return `${dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${rel}`;
};

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export default function ProjectsView() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("open");
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => api("/api/projects").then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => {
    let alive = true;
    const tick = () => api("/api/projects").then((d) => { if (alive) { setData(d); setErr(null); } }).catch((e) => alive && setErr(e.message));
    const t = setInterval(tick, 30000);
    Promise.resolve().then(tick); // first fetch off the synchronous effect body (react-hooks/set-state-in-effect)
    return () => { alive = false; clearInterval(t); };
  }, []);

  const projects = useMemo(() => {
    let list = data?.projects || [];
    if (filter === "open") list = list.filter((p) => OPEN_STATES.has(p.status) || p.source === "manual" || p.source === "plate");
    if (filter === "manual") list = list.filter((p) => p.source === "manual" || p.source === "plate");
    if (filter === "todo") list = list.filter((p) => (p.todos || []).some((t) => !t.done));
    if (q.trim()) { const s = q.toLowerCase(); list = list.filter((p) => (p.name + " " + (p.inflight?.title || "") + " " + (p.todos || []).map((t) => t.text).join(" ")).toLowerCase().includes(s)); }
    return list;
  }, [data, filter, q]);
  const visible = showAll ? projects : projects.slice(0, 18);

  const openTodos = (data?.projects || []).reduce((n, p) => n + (p.todos || []).filter((t) => !t.done).length, 0);

  const createProject = async () => {
    const name = newName.trim(); if (!name) return;
    await api("/api/projects", { method: "POST", body: JSON.stringify({ name }) });
    setNewName(""); load();
  };

  return (
    <Section title="Projects — running to-dos">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        {[["open", "Open"], ["todo", "Has to-dos"], ["manual", "Mine"], ["all", "Everything"]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ ...chip, background: filter === k ? "rgba(232,114,42,0.18)" : "rgba(255,255,255,0.04)", borderColor: filter === k ? C.accent : C.bdr, color: filter === k ? C.bright : C.text }}>{l}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…" style={{ ...input, minWidth: 140, flex: "1 1 140px" }} />
        <span style={{ fontSize: 11, color: C.dim, marginLeft: "auto" }}>
          {data ? `${data.counts.total} projects · ${openTodos} open to-dos · store ${data.updated ? fmtDate(data.updated) : "empty"}` : err ? `error: ${err}` : "loading…"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createProject()} placeholder="new project (e.g. Ads review, Perkins barndo, Email cleanup)" style={{ ...input, flex: 1 }} />
        <button onClick={createProject} style={{ ...chip, borderColor: C.accent, color: C.bright, background: "rgba(232,114,42,0.18)" }}>+ project</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
        {visible.map((p) => <ProjectCard key={`${p.id}:${p.progressNote || ""}`} p={p} reload={load} />)}
      </div>
      {projects.length > visible.length && (
        <button onClick={() => setShowAll(true)} style={{ ...chip, marginTop: 12 }}>show all {projects.length}</button>
      )}
      <div style={{ marginTop: 14, fontSize: 10, color: C.dim }}>
        Agents/CLI: <span className="mono">~/Dashboard/mission-control/scripts/todo.sh add "&lt;project&gt;" "&lt;to-do&gt;"</span> · store: <span className="mono">~/services/projects/projects.json</span> · IN-FLIGHT.md sections appear automatically.
      </div>
    </Section>
  );
}

function ProjectCard({ p, reload }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState(p.progressNote || ""); // card remounts (key) when the stored note changes
  const [editingNote, setEditingNote] = useState(false);
  const color = STATE_COLOR[p.status] || C.dim;
  const todos = p.todos || [];
  const open = todos.filter((t) => !t.done).length;
  const editable = p.source !== "inflight"; // inflight-only cards become manual on first to-do

  const add = async () => {
    const t = text.trim(); if (!t) return;
    await api(`/api/projects/${encodeURIComponent(p.id)}/todos`, { method: "POST", body: JSON.stringify({ text: t, name: p.name, by: "ui" }) });
    setText(""); reload();
  };
  const toggle = async (t) => {
    if (t.readOnly) return;
    await api(`/api/projects/${encodeURIComponent(p.id)}/todos/${t.id}`, { method: "PATCH", body: JSON.stringify({ done: !t.done }) });
    reload();
  };
  const remove = async (t) => {
    if (t.readOnly) return;
    await api(`/api/projects/${encodeURIComponent(p.id)}/todos/${t.id}`, { method: "DELETE" });
    reload();
  };
  const saveNote = async () => {
    setEditingNote(false);
    if (note === (p.progressNote || "")) return;
    await api(`/api/projects/${encodeURIComponent(p.id)}`, { method: "PATCH", body: JSON.stringify({ progressNote: note, name: p.name }) });
    reload();
  };
  const setStatus = async (status) => {
    await api(`/api/projects/${encodeURIComponent(p.id)}`, { method: "PATCH", body: JSON.stringify({ status, name: p.name }) });
    reload();
  };

  return (
    <div style={{ ...inn, padding: 12, display: "flex", flexDirection: "column", gap: 8, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.bright, lineHeight: 1.25 }}>{p.name}</div>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
            last touched {fmtDate(p.lastTouched)}{p.inflight?.line ? ` · IN-FLIGHT.md:${p.inflight.line}` : ""}{p.source === "manual" ? " · mine" : ""}
          </div>
        </div>
        <select value={p.status} onChange={(e) => setStatus(e.target.value)} disabled={p.source === "plate"} title="status"
          style={{ ...badge(p.status === "active" ? "healthy" : p.status === "blocked" ? "critical" : "warning"), background: "transparent", border: `1px solid ${color}`, color, cursor: "pointer", fontSize: 10, padding: "2px 6px", borderRadius: 6 }}>
          {Object.keys(STATE_LABEL).map((k) => <option key={k} value={k} style={{ color: "#000" }}>{STATE_LABEL[k]}</option>)}
        </select>
      </div>

      {editingNote ? (
        <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} rows={2}
          style={{ ...input, resize: "vertical", width: "100%", boxSizing: "border-box" }} placeholder="progress note — where this stands, what's next" />
      ) : (
        <div onClick={() => setEditingNote(true)} title="click to edit progress note"
          style={{ fontSize: 11, color: note ? C.text : C.dim, cursor: "text", minHeight: 16, whiteSpace: "pre-wrap" }}>
          {note || "＋ progress note"}
        </div>
      )}

      {todos.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {todos.map((t) => {
            const c = t.readOnly ? (STATE_COLOR[t.state] || C.dim) : t.done ? "#2A9D8F" : C.accent;
            return (
              <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }} title={t.note || (t.doneAt ? `done ${fmtDate(t.doneAt)}` : t.created ? `added ${fmtDate(t.created)}` : "")}>
                <span onClick={() => toggle(t)} style={{ color: c, fontSize: 12, fontWeight: 700, width: 14, textAlign: "center", cursor: t.readOnly ? "default" : "pointer", flexShrink: 0, lineHeight: "16px" }}>
                  {t.readOnly ? (t.state === "active" ? "✓" : t.state === "partial" ? "◐" : t.state === "waiting" ? "⏳" : "○") : t.done ? "✓" : "○"}
                </span>
                <span style={{ fontSize: 11, color: t.done ? "#94A3B8" : C.bright, textDecoration: t.done && !t.readOnly ? "line-through" : "none", flex: 1, lineHeight: "16px" }}>
                  {t.text}{t.readOnly && t.updated ? <span style={{ color: C.dim }}> · {fmtDate(t.updated)}</span> : null}
                </span>
                {!t.readOnly && <span onClick={() => remove(t)} title="remove" style={{ color: C.dim, cursor: "pointer", fontSize: 11 }}>×</span>}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={editable ? `add to-do (${open} open)` : "add a to-do (makes this yours)"} style={{ ...input, flex: 1 }} />
        <button onClick={add} style={chip}>+</button>
      </div>
    </div>
  );
}

const chip = { fontSize: 11, padding: "5px 10px", borderRadius: 8, border: `1px solid ${C.bdr}`, background: "rgba(255,255,255,0.04)", color: C.text, cursor: "pointer" };
const input = { fontSize: 11, padding: "6px 8px", borderRadius: 8, border: `1px solid ${C.bdr}`, background: "rgba(255,255,255,0.03)", color: C.bright, outline: "none" };
