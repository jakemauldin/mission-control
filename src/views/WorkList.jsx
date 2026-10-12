import { useCallback, useEffect, useMemo, useState } from "react";
import { C, BRAND, STATUS, crd } from "../lib/colors";
import { useWebSocket } from "../hooks/useWebSocket";

// To-dos — one live list of everything open, from GET /api/work (Jake 2026-10-12: "I want all of this synced
// so that way these items can be worked"). Sources: App Builds roadmap steps, the docs/status jake-todo files,
// project to-dos, TODO.md items that need Jake, and IN-FLIGHT job cards. The server pushes work_update when
// any of those files changes, so there is no polling. Checking a box or handing a step to an agent goes
// through POST /api/work/:id; TODO.md and IN-FLIGHT rows are read-only.

const STALE_DAYS = 21;
const SOURCE_TAG = { apps: "Roadmap", "jake-todo": "Today", projects: "Project", backlog: "TODO", inflight: "Job" };
const STATE_LABEL = { needs_me: "Needs me", agent_working: "Agent on it", queued: "Up next", waiting: "Waiting", done: "Done", later: "Later" };
const STATE_COLOR = { needs_me: BRAND.accent, agent_working: "#6CC3DF", queued: C.dim, waiting: STATUS.warn, done: STATUS.good, later: C.dim };
const ageDays = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 864e5 : Infinity);
const ageText = (iso) => {
  const d = ageDays(iso);
  if (!Number.isFinite(d)) return "";
  return d < 1 / 24 ? "just now" : d < 1 ? `${Math.floor(d * 24)} h` : `${Math.floor(d)} d`;
};
const FILTERS = [
  ["needs_me", "Needs me", (i) => i.state === "needs_me"],
  ["agent_working", "Agents on it", (i) => i.state === "agent_working"],
  ["queued", "Up next", (i) => i.state === "queued"],
  ["waiting", "Waiting", (i) => i.state === "waiting"],
  ["done", "Done this week", (i) => i.state === "done" && ageDays(i.updatedAt) <= 7],
  ["all", "All open", (i) => i.state !== "done" && i.state !== "later"],
];
// Only these can be checked off; the server answers 422 for the rest.
const checkable = (i) => i.writable && ["apps", "jake-todo", "projects"].includes(i.source);
// Hand-off needs a real apps.json step id (generated ids look like apps:<app>:<hash>).
// Steps on Jake's own lane (installing a build on his phone, pressing Submit) can't go to an agent.
const handable = (i) => i.source === "apps" && i.writable && i.id.split(":").length === 2 && i.lane !== "jake" && !["done", "agent_working"].includes(i.state);
const groupName = (i) => i.project || (i.source === "jake-todo" ? "Today's list" : i.source === "backlog" ? "Backlog (TODO.md)" : "Other");

export default function WorkList() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("needs_me");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null);
  const [flash, setFlash] = useState(null);

  const load = useCallback(() => fetch("/api/work")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d) => { setData(d); setErr(null); })
    .catch((e) => setErr(e.message)), []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  const ws = useWebSocket();
  useEffect(() => { if (ws.lastMessage?.type === "work_update") load(); }, [ws.lastMessage, load]);

  const items = useMemo(() => data?.items || [], [data]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k, , fn]) => [k, items.filter(fn).length])), [items]);
  const groups = useMemo(() => {
    let list = items.filter(FILTERS.find(([k]) => k === filter)[2]);
    if (q.trim()) { const s = q.toLowerCase(); list = list.filter((i) => (i.title + " " + (i.project || "")).toLowerCase().includes(s)); }
    const fresh = new Map(), old = [];
    for (const i of list) {
      // Anything untouched for 3 weeks drops into one "older" group at the bottom, so stale rows stop crowding the list.
      if (filter !== "done" && ageDays(i.updatedAt) > STALE_DAYS) { old.push(i); continue; }
      const g = groupName(i);
      if (!fresh.has(g)) fresh.set(g, []);
      fresh.get(g).push(i);
    }
    // Today's list first, roadmap and project groups by size, the TODO.md backlog last.
    const rank = (name) => (name === "Today's list" ? 0 : name.startsWith("Backlog") ? 2 : 1);
    const out = [...fresh.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length);
    if (old.length) out.push([`Older than ${STALE_DAYS} days`, old]);
    return out;
  }, [items, filter, q]);

  const act = async (i, action, extra = {}) => {
    setBusy(i.id); setFlash(null);
    try {
      const r = await fetch(`/api/work/${encodeURIComponent(i.id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expect: i.title, ...extra }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) {
        setFlash(r.status === 409 ? "That line changed since you loaded it. Reloaded, try again." : `Didn't save (${d.error || r.status}).`);
      }
    } catch (e) { setFlash(`Didn't save (${e.message}).`); }
    setBusy(null); load();
  };

  if (!data) return <div style={{ color: C.dim, fontSize: 13, padding: 8 }}>{err ? `Could not load the list (${err}).` : "Loading…"}</div>;

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
            style={{ ...chip, background: filter === k ? "rgba(122,178,255,0.16)" : "rgba(255,255,255,0.04)", borderColor: filter === k ? BRAND.border : C.border, color: filter === k ? BRAND.focus : C.text }}>
            {l} <span style={{ color: C.dim, marginLeft: 2 }}>{counts[k]}</span>
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…" aria-label="Search to-dos" style={{ ...input, minWidth: 120, flex: "1 1 140px" }} />
      </div>
      {flash && <div style={{ fontSize: 12, color: STATUS.warn }}>{flash}</div>}
      {err && <div style={{ fontSize: 12, color: STATUS.warn }}>Last refresh failed ({err}). Showing the previous copy.</div>}
      {!groups.length && <div style={{ color: C.dim, fontSize: 13, padding: "8px 2px" }}>Nothing here.</div>}
      {groups.map(([name, rows]) => <Group key={name} name={name} rows={rows} busy={busy} act={act} startOpen={!name.startsWith("Older")} />)}
    </div>
  );
}

function Group({ name, rows, busy, act, startOpen }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div style={{ ...crd, padding: 0, overflow: "hidden" }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px", background: "none", border: 0, color: C.bright, cursor: "pointer", font: "inherit", textAlign: "left" }}>
        <span style={{ fontSize: 14, fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" }}>{name}</span>
        <span style={{ fontSize: 12, color: C.dim, whiteSpace: "nowrap" }}>{rows.length} {open ? "▾" : "▸"}</span>
      </button>
      {open && <div>{rows.map((i) => <Row key={i.id} i={i} busy={busy === i.id} act={act} />)}</div>}
    </div>
  );
}

function Row({ i, busy, act }) {
  const [more, setMore] = useState(false);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const done = i.state === "done";
  const canCheck = checkable(i);
  const long = i.title.length > 160;
  const sendNote = () => { const t = note.trim(); if (!t) return; setNoting(false); setNote(""); act(i, "note", { text: t }); };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, padding: "9px 14px", borderTop: `1px solid ${C.border}`, opacity: busy ? 0.55 : 1, alignItems: "start" }}>
      {canCheck ? <button onClick={() => !busy && act(i, done ? "reopen" : "done")} disabled={busy}
        aria-label={done ? "Reopen" : "Mark done"} title={done ? "Reopen" : "Mark done"}
        style={{ width: 20, height: 20, marginTop: 1, borderRadius: 5, border: `1.5px solid ${done ? STATUS.good : BRAND.border}`, background: done ? "rgba(111,208,47,0.18)" : "transparent", color: STATUS.good, fontSize: 13, lineHeight: "16px", padding: 0, cursor: "pointer", flex: "none" }}>
        {done ? "✓" : ""}
      </button>
      : <span title="Read-only here. It lives in TODO.md or IN-FLIGHT.md." aria-label="Read-only"
        style={{ width: 20, height: 20, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, fontSize: 16, flex: "none" }}>•</span>}
      <div style={{ minWidth: 0 }}>
        <div onClick={() => long && setMore(!more)}
          style={{ fontSize: 13, color: done ? C.dim : C.bright, textDecoration: done ? "line-through" : "none", lineHeight: 1.4, overflowWrap: "anywhere", cursor: long ? "pointer" : "default",
            ...(long && !more ? { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } : null) }}>
          {i.title}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center", marginTop: 3, fontSize: 11, color: C.dim }}>
          <span style={{ color: STATE_COLOR[i.state] }}>{STATE_LABEL[i.state]}</span>
          <span>{(i.sources || [i.source]).map((s) => SOURCE_TAG[s] || s).join(" + ")}</span>
          {i.lane && i.lane !== "jake" && <span style={{ textTransform: "capitalize" }}>{i.lane}</span>}
          {i.updatedAt && i.source !== "backlog" && <span>{ageText(i.updatedAt)}</span>}
          {i.link && <a href={i.link} target="_blank" rel="noopener noreferrer" style={{ color: BRAND.link }}>PR</a>}
          {canCheck && !done && <button onClick={() => setNoting(!noting)} style={tiny}>note</button>}
          {handable(i) && <>
            <button onClick={() => act(i, "assign", { lane: "codex" })} disabled={busy} style={tiny}>hand to Codex</button>
            <button onClick={() => act(i, "assign", { lane: "claude" })} disabled={busy} style={tiny}>hand to Claude</button>
          </>}
        </div>
        {noting && (
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendNote()} placeholder="where this stands" maxLength={500} style={{ ...input, flex: 1 }} />
            <button onClick={sendNote} style={chip}>save</button>
          </div>
        )}
      </div>
    </div>
  );
}

const chip = { fontSize: 12, padding: "5px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.04)", color: C.text, cursor: "pointer" };
const tiny = { fontSize: 11, padding: "1px 6px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: BRAND.link, cursor: "pointer" };
const input = { fontSize: 12, padding: "6px 8px", borderRadius: 8, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.03)", color: C.bright, outline: "none" };
