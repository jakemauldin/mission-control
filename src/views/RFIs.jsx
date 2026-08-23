// RFI workspace, phase 2 interactivity (DESIGN.md §4): status changes, notes, draft-assist, live updates.
import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { C, BRAND } from "../lib/colors";
import { Section } from "../components/ui/Card";
import { useWebSocket } from "../hooks/useWebSocket";

const ST = {
  blocking: { label: "BLOCKING", color: "#f87171" },
  before_submittal: { label: "BEFORE SUBMITTAL", color: "#fbbf24" },
  cleanup: { label: "CLEANUP", color: "#94a3b8" },
  closed: { label: "CLOSED", color: "#4ade80" },
};
const ST_KEYS = ["blocking", "before_submittal", "cleanup", "closed"];
const KEY_TO_STATUS = { "1": "blocking", "2": "before_submittal", "3": "cleanup", "4": "closed" };

export function RfiIndex() {
  const [jobs, setJobs] = useState(null);
  useEffect(() => { fetch("/api/rfis").then(r => r.json()).then(d => setJobs(d.data)).catch(() => setJobs([])); }, []);
  if (!jobs) return <Section title="RFIs"><div style={{ color: C.dim }}>Loading…</div></Section>;
  return (
    <Section title="RFIs by job">
      {jobs.length === 0 && <div style={{ color: C.dim }}>No job has an RFI log yet.</div>}
      {jobs.map(j => (
        <Link key={j.dir} to={`/rfis/${j.jobId}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.border}`, textDecoration: "none", color: C.text }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{j.job}</div>
            <div style={{ color: C.dim, fontSize: 12 }}>{j.title} · revised {j.revised || "?"}</div>
          </div>
          {j.counts.blocking > 0 && <span style={{ color: ST.blocking.color, fontSize: 12, fontWeight: 700 }}>{j.counts.blocking} blocking</span>}
          {j.counts.before_submittal > 0 && <span style={{ color: ST.before_submittal.color, fontSize: 12 }}>{j.counts.before_submittal} pre-submittal</span>}
          <span style={{ color: C.dim, fontSize: 12 }}>{j.counts.closed || 0} closed</span>
        </Link>
      ))}
    </Section>
  );
}

function draftReply(it) {
  const lines = [
    `RE: ${it.id} — ${it.title}`,
    "",
    it.concern ? `Concern: ${it.concern}` : null,
    it.our_read ? `Our read: ${it.our_read}` : null,
    it.ask ? `Ask: ${it.ask}` : null,
    "",
    "Response: ",
  ].filter(l => l !== null);
  return lines.join("\n");
}

function Item({ it, jobId, focused, onFocus, onPatch }) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const st = ST[it.status] || { label: it.status, color: C.dim };
  const log = it.log || [];

  const setStatus = async (status) => {
    if (status === it.status) return;
    const prevStatus = it.status;
    onPatch(it.id, { status });
    const r = await fetch(`/api/rfis/${jobId}/items/${it.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (!r.ok) onPatch(it.id, { status: prevStatus }); // revert
  };

  const saveNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    const r = await fetch(`/api/rfis/${jobId}/items/${it.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
    });
    setSaving(false);
    if (r.ok) { setNote(""); setShowNote(false); onPatch(null, null, true); } // signal re-fetch
  };

  return (
    <div
      id={`item-${it.id}`}
      tabIndex={0}
      onClick={() => onFocus(it.id)}
      onFocus={() => onFocus(it.id)}
      onKeyDown={e => { if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; if (KEY_TO_STATUS[e.key]) setStatus(KEY_TO_STATUS[e.key]); }}
      style={{
        padding: "12px 10px", borderBottom: `1px solid ${C.border}`, outline: "none",
        background: focused ? "rgba(255,255,255,0.03)" : "transparent",
        borderLeft: focused ? `2px solid ${BRAND.focus}` : "2px solid transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: "monospace", color: C.dim, fontSize: 12 }}>{it.id}</span>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{it.title}</span>
        <span style={{ color: st.color, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>{st.label}</span>
      </div>
      {it.concern && <p style={{ margin: "6px 0 0", fontSize: 13, color: C.text, lineHeight: 1.5 }}>{it.concern}</p>}
      {it.ask && <p style={{ margin: "6px 0 0", fontSize: 13, color: BRAND.focus, lineHeight: 1.5 }}><b>Ask:</b> {it.ask}</p>}
      {it.update && <p style={{ margin: "6px 0 0", fontSize: 12, color: C.dim, lineHeight: 1.5 }}>Update: {it.update}</p>}

      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {ST_KEYS.map(k => (
          <button key={k} onClick={e => { e.stopPropagation(); setStatus(k); }}
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "3px 8px", borderRadius: 20,
              cursor: "pointer", background: it.status === k ? ST[k].color : "transparent",
              color: it.status === k ? "#0a0a0a" : ST[k].color, border: `1px solid ${ST[k].color}`,
            }}>
            {ST[k].label}
          </button>
        ))}
        <button onClick={e => { e.stopPropagation(); setShowNote(v => !v); }}
          style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, cursor: "pointer", background: "none", color: C.dim, border: `1px solid ${C.border}` }}>
          note
        </button>
        <button onClick={e => { e.stopPropagation(); setShowDraft(v => !v); }}
          style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, cursor: "pointer", background: "none", color: C.dim, border: `1px solid ${C.border}` }}>
          draft reply
        </button>
        {log.length > 0 && (
          <button onClick={e => { e.stopPropagation(); setShowLog(v => !v); }}
            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, cursor: "pointer", background: "none", color: C.dim, border: `1px solid ${C.border}` }}>
            history ({log.length})
          </button>
        )}
      </div>

      {showNote && (
        <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Add a note…"
            style={{ width: "100%", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
          <button onClick={saveNote} disabled={saving || !note.trim()}
            style={{ marginTop: 6, fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer", background: "none", color: BRAND.link, border: `1px solid ${BRAND.border}` }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {showDraft && (
        <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
          <textarea readOnly value={draftReply(it)} rows={6}
            style={{ width: "100%", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, fontSize: 12, fontFamily: "inherit", resize: "vertical" }} />
        </div>
      )}

      {showLog && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {log.map((l, i) => (
            <div key={i} style={{ fontSize: 11, color: C.dim }}>
              <span style={{ fontFamily: "monospace" }}>{l.ts}</span> — <b>{l.who}</b>: {l.note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RfiJob() {
  const { jobId } = useParams();
  const { hash } = useLocation();
  const [rfi, setRfi] = useState(null);
  const [err, setErr] = useState(null);
  const [focusedId, setFocusedId] = useState(null);
  const { lastMessage } = useWebSocket();

  const load = useCallback(() => {
    fetch(`/api/rfis/${jobId}`).then(async r => {
      if (r.status === 401) throw new Error("session expired");
      if (!r.ok) throw new Error((await r.json()).error || r.status);
      setRfi((await r.json()).data);
      setErr(null);
    }).catch(e => setErr(String(e.message || e)));
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (rfi && hash) setTimeout(() => document.querySelector(hash)?.scrollIntoView({ block: "center" }), 100);
  }, [rfi, hash]);

  useEffect(() => {
    if (lastMessage?.type === "rfi_update" && String(lastMessage.jobId) === String(jobId)) load();
  }, [lastMessage, jobId, load]);

  // optimistic patch helper: patchItem(itemId, fields) mutates local state; patchItem(null,null,true) forces re-fetch
  const patchItem = (itemId, fields, forceReload) => {
    if (forceReload) { load(); return; }
    setRfi(prev => {
      if (!prev) return prev;
      return { ...prev, groups: prev.groups.map(g => ({
        ...g, items: g.items.map(it => it.id === itemId ? { ...it, ...fields } : it),
      })) };
    });
  };

  if (err) return <Section title="RFIs"><div style={{ color: C.dim }}>{err}</div></Section>;
  if (!rfi) return <Section title="RFIs"><div style={{ color: C.dim }}>Loading…</div></Section>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Link to="/rfis" style={{ color: BRAND.link, fontSize: 13, textDecoration: "none" }}>← all jobs</Link>
        <h2 style={{ margin: "6px 0 2px", fontSize: 18 }}>{rfi.job} — {rfi.title}</h2>
        <div style={{ color: C.dim, fontSize: 12 }}>{rfi.address} · issued by {rfi.issued_by} · revised {rfi.revised}</div>
      </div>
      {(rfi.groups || []).map(g => (
        <Section key={g.key} title={`${g.name}${g.contact ? " — " + g.contact : ""}`}>
          {(g.items || []).map(it => (
            <Item key={it.id} it={it} jobId={jobId} focused={focusedId === it.id} onFocus={setFocusedId} onPatch={patchItem} />
          ))}
        </Section>
      ))}
    </div>
  );
}
