// Media workspace (DESIGN.md §3). Phase 2 adds generation dispatch: the UI collects
// INTENT only — the prompt itself is authored by Fable in Jake's session, never here.
import { useState, useEffect, useCallback } from "react";
import { C, BRAND } from "../lib/colors";
import { Section } from "../components/ui/Card";
import { useWebSocket } from "../hooks/useWebSocket";

const GALLERY = "http://100.92.25.23:3251";
const STATUS_COLOR = { "awaiting-prompt": "#fbbf24", queued: "#94a3b8", running: BRAND.focus, done: "#4ade80", failed: "#f87171" };

export default function Media() {
  const [counts, setCounts] = useState(null);
  const [queue, setQueue] = useState([]);
  const [form, setForm] = useState({ type: "social ad", aspect: "9x16", jobContext: "", intent: "", refs: "" });
  const [created, setCreated] = useState(null);
  const [recent, setRecent] = useState([]);
  const [picked, setPicked] = useState([]);   // rel paths chosen as refs
  const ws = useWebSocket();

  const loadQueue = useCallback(() => {
    fetch("/api/media/generate").then(r => r.json()).then(d => setQueue(d.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    fetch("/api/media/counts").then(r => r.json()).then(d => setCounts(d.data)).catch(() => {});
    fetch("/api/media/recent?bucket=postable&n=36").then(r => r.json()).then(d => setRecent(d.data || [])).catch(() => {});
    loadQueue();
  }, [loadQueue]);
  useEffect(() => { if (ws.lastMessage?.type === "gen_update") loadQueue(); }, [ws.lastMessage, loadQueue]);

  const submit = async (e) => {
    e.preventDefault();
    const body = { ...form, refs: [...picked, ...form.refs.split(",").map(s => s.trim()).filter(Boolean)] };
    const r = await fetch("/api/media/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.ok) { setCreated(d.data); setForm(f => ({ ...f, intent: "", refs: "" })); setPicked([]); loadQueue(); }
  };

  const cell = (label, n, hot) => (
    <div key={label} style={{ flex: 1, minWidth: 90, textAlign: "center", padding: "14px 6px", background: C.card, border: `1px solid ${hot ? BRAND.border : C.border}`, borderRadius: 10 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: hot ? BRAND.focus : C.bright }}>{n ?? "—"}</div>
      <div style={{ fontSize: 11, color: C.dim, marginTop: 2, letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
  const inp = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {cell("AWAITING YOU", counts?.undecided, true)}
        {cell("AD WORTHY", counts?.approved)}
        {cell("POSTABLE", counts?.postable)}
        {cell("RECORDS", counts?.records)}
        {cell("TRASH", counts?.trash)}
      </div>

      <Section title="Grade & pick">
        <a href={GALLERY} target="_blank" rel="noreferrer"
          style={{ display: "inline-block", padding: "10px 18px", background: BRAND.accent, color: "#0C1017", borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
          Open the gallery →
        </a>
      </Section>

      <Section title="Generate">
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={inp}>
              {["social ad", "showcase reel", "daily graphic", "still"].map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={form.aspect} onChange={e => setForm(f => ({ ...f, aspect: e.target.value }))} style={inp}>
              {["9x16", "16x9", "1x1", "4x5"].map(a => <option key={a}>{a}</option>)}
            </select>
            <input value={form.jobContext} onChange={e => setForm(f => ({ ...f, jobContext: e.target.value }))} placeholder="job context (e.g. 119 Thomas Hearth)" style={{ ...inp, flex: 1, minWidth: 180 }} />
          </div>
          <textarea value={form.intent} onChange={e => setForm(f => ({ ...f, intent: e.target.value }))} rows={2} required
            placeholder="What should this piece DO — not how it should look. The prompt gets composed in Jake's session."
            style={{ ...inp, resize: "vertical" }} />
          {recent.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>
                Tap photos to attach as references ({picked.length} picked) — newest postable shots:
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6 }}>
                {recent.map(m => {
                  const on = picked.includes(m.file);
                  return (
                    <img key={m.label} src={`/api/media/thumb?rel=${encodeURIComponent(m.file)}`} alt={m.shows}
                      title={`${m.label} — ${m.shows}`} loading="lazy"
                      onClick={() => setPicked(p => on ? p.filter(x => x !== m.file) : [...p, m.file])}
                      style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, cursor: "pointer",
                               border: on ? `3px solid ${BRAND.focus}` : `1px solid ${C.border}`,
                               opacity: on ? 1 : 0.85 }} />
                  );
                })}
              </div>
            </div>
          )}
          <input value={form.refs} onChange={e => setForm(f => ({ ...f, refs: e.target.value }))}
            placeholder="extra reference paths, comma-separated (optional)" style={inp} />
          <div>
            <button type="submit" style={{ padding: "9px 16px", background: BRAND.accent, color: "#0C1017", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              Queue it
            </button>
            <span style={{ color: C.dim, fontSize: 12, marginLeft: 10 }}>Fable writes the prompt; this only files the intent.</span>
          </div>
        </form>
        {created && (
          <div style={{ marginTop: 12, padding: 12, background: C.bg, border: `1px solid ${BRAND.border}`, borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: BRAND.focus, marginBottom: 6 }}>Queued {created.id} — hand this brief to the session:</div>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: C.text, margin: 0, fontFamily: "monospace" }}>{created.brief}</pre>
            <button onClick={() => navigator.clipboard?.writeText(created.brief)} style={{ marginTop: 8, padding: "6px 12px", background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, fontSize: 12, cursor: "pointer" }}>Copy brief</button>
          </div>
        )}
      </Section>

      <Section title={`Dispatch queue${queue.length ? ` (${queue.length})` : ""}`}>
        {queue.length === 0 && <div style={{ color: C.dim, fontSize: 13 }}>Nothing queued.</div>}
        {queue.map(q => (
          <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[q.status] || C.dim }} />
            <span style={{ fontFamily: "monospace", fontSize: 12, color: C.dim }}>{q.id}</span>
            <span style={{ flex: 1, fontSize: 13 }}>{q.type} · {q.aspect}{q.jobContext ? ` · ${q.jobContext}` : ""} — {q.intent?.slice(0, 60)}</span>
            <span style={{ fontSize: 11, color: STATUS_COLOR[q.status] || C.dim, fontWeight: 700, letterSpacing: 0.5 }}>{q.status.toUpperCase()}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}
