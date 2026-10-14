// Desktop sessions by tag (2026-10-14). The desktop sidebar files a session in one folder; here a session
// carries every tag it earns (job number, product, topic), so a Stetson job session that is also Jev work
// shows under both. Data: /api/sessions/tags (server/lib/sessionTags.js → ~/services/scripts/session-tags.py).
import { useState, useEffect, useCallback } from "react";
import { C, STATUS } from "../lib/colors";
import { btnS } from "../lib/helpers";
import { Section } from "../components/ui/Card";

const KIND_LABEL = { job: "Jobs", product: "Products", topic: "Topics" };
const KIND_ORDER = ["job", "product", "topic"];
const STATE_ORDER = { "your turn": 0, running: 1, done: 2 };
const STATE_COLOR = { running: STATUS.good, "your turn": STATUS.warn, done: C.dim };
const PR_ORDER = { OPEN: 0, MERGED: 1, CLOSED: 2 };
const SORTS = [
  ["activity", "Last activity"],
  ["state", "State"],
  ["job", "Job"],
  ["pr", "Open PR"],
];

function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

const jobNum = (s) => {
  const t = s.tags.find((x) => x.kind === "job");
  const m = t && /^#(\d+)/.exec(t.name);
  return t ? (m ? +m[1] : 9999) : Infinity; // untagged-by-job sink to the bottom
};

const chipS = (on, kind) => ({
  fontSize: 11, padding: "2px 8px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
  border: `1px solid ${on ? C.accent : C.border}`,
  background: on ? C.accent : kind === "job" ? "rgba(255,86,0,0.08)" : kind === "product" ? "rgba(111,208,47,0.08)" : "rgba(255,255,255,0.04)",
  color: on ? "#1B1D29" : C.text, whiteSpace: "nowrap",
});

function Row({ s, tag, onTag }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.border}` }} data-session={s.id}>
      <span title={s.state} style={{ width: 8, height: 8, marginTop: 5, borderRadius: "50%", background: STATE_COLOR[s.state], flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          {s.link
            ? <a href={s.link} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: C.bright, textDecoration: "none" }}>{s.title}</a>
            : <span style={{ fontSize: 13, fontWeight: 600, color: C.bright }}>{s.title}</span>}
          <span style={{ fontSize: 11, color: STATE_COLOR[s.state] }}>{s.state}</span>
          <span style={{ fontSize: 11, color: C.dim }}>{s.updated ? `${ago(s.updated)} ago` : ""}</span>
          {s.pr && (
            <a href={s.pr.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: s.pr.state === "OPEN" ? STATUS.good : C.dim, fontFamily: C.mono }}>
              PR {s.pr.number} {(s.pr.state || "").toLowerCase()}
            </a>
          )}
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
          {s.tags.map((t) => (
            <button key={t.kind + t.name} style={chipS(tag === t.name, t.kind)} onClick={() => onTag(t.name)}
              title={s.tagSource === "haiku" ? "tagged by Haiku (no rule matched)" : t.kind}>{t.name}</button>
          ))}
          {s.tags.length === 0 && <span style={{ fontSize: 11, color: C.dim }}>no tag yet</span>}
          {s.folder && <span style={{ fontSize: 11, color: C.dim }}>· sidebar: {s.folder}</span>}
        </div>
        {s.now && <div style={{ fontSize: 11, color: C.dim, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.now}</div>}
      </div>
    </div>
  );
}

export default function SessionTags() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [tag, setTag] = useState(() => new URLSearchParams(location.search).get("tag") || "");
  const [stateF, setStateF] = useState("all");
  const [sort, setSort] = useState("activity");
  const [showAllTags, setShowAllTags] = useState(false);
  const [limit, setLimit] = useState(25);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/sessions/tags");
      const body = await r.json();
      if (!body.ok) throw new Error(body.message || `HTTP ${r.status}`);
      setRows(body.data);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const pick = (name) => {
    const next = tag === name ? "" : name;
    setTag(next);
    const u = new URL(location.href);
    if (next) u.searchParams.set("tag", next); else u.searchParams.delete("tag");
    history.replaceState(null, "", u);
  };

  if (!rows) return <Section title="Sessions by tag"><div style={{ color: C.dim, fontSize: 13 }}>{err || "Loading…"}</div></Section>;

  // tag → {kind, count}
  const counts = new Map();
  for (const s of rows) for (const t of s.tags) {
    const c = counts.get(t.name) || { kind: t.kind, n: 0 };
    c.n++;
    counts.set(t.name, c);
  }
  const byKind = KIND_ORDER.map((k) => [k, [...counts].filter(([, c]) => c.kind === k).sort((a, b) => b[1].n - a[1].n)]);

  const shown = rows
    .filter((s) => (!tag || s.tags.some((t) => t.name === tag)) && (stateF === "all" || s.state === stateF))
    .sort((a, b) => {
      if (sort === "state") return STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.updated - a.updated;
      if (sort === "job") return jobNum(a) - jobNum(b) || b.updated - a.updated;
      if (sort === "pr") return (a.pr ? PR_ORDER[a.pr.state] ?? 3 : 4) - (b.pr ? PR_ORDER[b.pr.state] ?? 3 : 4) || b.updated - a.updated;
      return b.updated - a.updated;
    });
  const multi = rows.filter((s) => s.tags.length > 1).length;

  return (
    <Section title="Sessions by tag">
      <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>
        {rows.length} desktop sessions, {multi} under more than one tag. The sidebar files each in one folder; here a session shows under every job, product and topic it touches.
      </div>
      {byKind.map(([kind, list]) => list.length > 0 && (
        <div key={kind} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: C.dim, width: 62 }}>{KIND_LABEL[kind]}</span>
          {(showAllTags || kind !== "topic" ? list : list.slice(0, 8)).map(([name, c]) => (
            <button key={name} style={chipS(tag === name, kind)} onClick={() => pick(name)}>{name} {c.n}</button>
          ))}
          {kind === "topic" && list.length > 8 && (
            <button style={{ ...chipS(false), color: C.dim }} onClick={() => setShowAllTags((v) => !v)}>{showAllTags ? "fewer" : `+${list.length - 8}`}</button>
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "10px 0 6px" }}>
        {["all", "running", "your turn", "done"].map((f) => (
          <button key={f} style={{ ...btnS(stateF === f), textTransform: "capitalize" }} onClick={() => setStateF(f)}>{f}</button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.dim }}>Sort</span>
        {SORTS.map(([k, label]) => (
          <button key={k} style={btnS(sort === k)} onClick={() => setSort(k)}>{label}</button>
        ))}
      </div>
      {tag && <div style={{ fontSize: 12, color: C.text, margin: "4px 0" }}>Tag <b>{tag}</b>: {shown.length} sessions · <button style={{ ...btnS(false), padding: "2px 8px" }} onClick={() => pick(tag)}>clear</button></div>}
      {shown.slice(0, limit).map((s) => <Row key={s.id} s={s} tag={tag} onTag={pick} />)}
      {shown.length === 0 && <div style={{ color: C.dim, fontSize: 13 }}>Nothing matches.</div>}
      {shown.length > limit && <button style={{ ...btnS(false), marginTop: 8 }} onClick={() => setLimit((n) => n + 50)}>Show more ({shown.length - limit})</button>}
    </Section>
  );
}
