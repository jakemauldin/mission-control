// RFI workspace (DESIGN.md §4), grouped by where each item stands (rfi.json "stage") rather than by urgency.
// Jake 2026-10-12: four colored status chips said how urgent an item was, not where it stood, and items settled on
// calls looked the same as items nobody had answered. Each card now says in one line where it stands and who moves next.
import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { C, BRAND, STATUS } from "../lib/colors";
import { Section } from "../components/ui/Card";
import { useWebSocket } from "../hooks/useWebSocket";
import Md from "../components/Md";
import { useOnFocus } from "../hooks/useOnFocus";
import { STAGES, stageOf, stageLabel, rowStages } from "../lib/rfiStage";

// keys follow the section order on the page
const KEY_TO_STAGE = { "1": "needs_answer", "2": "our_move", "3": "agreed", "4": "closed" };

const md = (d) => { const m = String(d || "").match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${+m[1]}/${+m[2]}` : ""; };
const daysSince = (d) => { const t = Date.parse(String(d || "").slice(0, 10) + "T12:00:00"); return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The RFI list is hand-kept; the job log is where calls, emails and decisions land first. When the
// log has dated entries newer than the list's "revised" date, the list may be behind (it sat at 9/17
// while #119 ran to 10/9 and nobody could tell from this page). The server counts them (jobLog).
function Drift({ jobLog, revised }) {
  if (!jobLog?.after) return null;
  return (
    <div style={{ color: STATUS.warn, fontSize: 12, marginTop: 4 }}>
      List last updated {md(revised) || "?"}. The job log has {jobLog.after} newer entr{jobLog.after === 1 ? "y" : "ies"} (latest {md(jobLog.latest)}), so some items may be out of date.
    </div>
  );
}

// "#119 Thomas Hearth": name from the RFI title ("Thomas Hearth — RFI Log"), else the folder slug.
function jobLabel({ jobId, dir, title }) {
  let name = String(title || "").split(/\s[—–-]\s/)[0].trim();
  if (!name || /^rfi/i.test(name)) name = String(dir || "").replace(/^\d+-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return `#${jobId}${name ? " " + name : ""}`;
}

// One line of counts for a job: the RFI index and the job page both use it. Only "blocking" gets a color.
export function RfiCounts({ row }) {
  const s = rowStages(row);
  const parts = [
    s.needs_answer && `${s.needs_answer} need${s.needs_answer === 1 ? "s" : ""} an answer`,
    s.our_move && `${s.our_move} our move`,
    s.agreed && `${s.agreed} agreed, waiting on drawings`,
  ].filter(Boolean);
  return (
    <>
      {s.blocking > 0 && <span style={{ color: STATUS.bad, fontSize: 12, fontWeight: 700 }}>{s.blocking} blocking</span>}
      {parts.length > 0 && <span style={{ color: C.text, fontSize: 12 }}>{parts.join(" · ")}</span>}
      <span style={{ color: C.dim, fontSize: 12 }}>{s.closed || 0} closed</span>
    </>
  );
}

export function RfiIndex() {
  const [jobs, setJobs] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => fetch("/api/rfis")
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(d => { if (d.ok === false) throw new Error(d.error || "error"); setJobs(d.data || []); setErr(null); })
    .catch(e => setErr(String(e.message || e))), []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  const { lastMessage } = useWebSocket();
  useEffect(() => { if (lastMessage?.type === "rfi_update") load(); }, [lastMessage, load]);
  useOnFocus(load);
  if (!jobs) return <Section title="RFIs"><div style={{ color: C.dim }}>{err ? `Could not load the RFI list (${err}).` : "Loading…"}</div></Section>;
  return (
    <Section title="RFIs by job">
      {jobs.length === 0 && <div style={{ color: C.dim }}>No job has an RFI log yet.</div>}
      {jobs.map(j => (
        <Link key={j.dir} to={`/rfis/${j.jobId}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", padding: "12px 0", borderBottom: `1px solid ${C.border}`, textDecoration: "none", color: C.text }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{jobLabel(j)}</div>
            <div style={{ color: C.dim, fontSize: 12 }}>{j.title} · revised {j.revised || "?"}</div>
            <Drift jobLog={j.jobLog} revised={j.revised} />
          </div>
          <RfiCounts row={j} />
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

const btn = { fontSize: 11, padding: "3px 8px", borderRadius: 6, cursor: "pointer", background: "none", color: C.dim, border: `1px solid ${C.border}` };
const field = { width: "100%", boxSizing: "border-box", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "inherit" };

async function patch(jobId, itemId, body) {
  const r = await fetch(`/api/rfis/${jobId}/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.ok;
}

function Item({ it, jobId, group, focused, onFocus, onPatch }) {
  const stage = stageOf(it);
  const closed = stage === "closed";
  const [panel, setPanel] = useState(null); // details | note | edit | draft
  const [note, setNote] = useState("");
  const [stands, setStands] = useState(it.stands || "");
  const [who, setWho] = useState(it.next?.who || "");
  const [what, setWhat] = useState(it.next?.what || "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const log = it.log || [];
  const latest = log.length ? log[log.length - 1] : null;
  const waited = it.next?.since ? daysSince(it.next.since) : null;
  const toggle = p => {
    setMsg("");
    // the file can change under an open page (voice-dump, another tab), so the form starts from what is there now
    if (p === "edit" && panel !== "edit") { setStands(it.stands || ""); setWho(it.next?.who || ""); setWhat(it.next?.what || ""); }
    setPanel(v => (v === p ? null : p));
  };

  const setStage = async (next) => {
    if (next === stage) return;
    const prev = { stage: it.stage, status: it.status };
    const status = next === "closed" ? "closed" : it.status === "closed" ? "before_submittal" : it.status;
    onPatch(it.id, { stage: next, status });
    if (!(await patch(jobId, it.id, { stage: next }))) { onPatch(it.id, prev); setMsg("Stage did not save. Try again."); }
  };

  const save = async (body, after) => {
    setSaving(true);
    const ok = await patch(jobId, it.id, body);
    setSaving(false);
    if (ok) { after?.(); setMsg(""); setPanel(null); onPatch(null, null, true); }
    else setMsg("Did not save. Try again.");
  };

  // "Latest" only when there is no stands line; once stands exists it already says where the item is
  const fallback = !it.stands && latest ? `${md(latest.ts)}, ${latest.who}: ${String(latest.note).replace(/^\d{1,2}\/\d{1,2}:\s*/, "")}` : "";

  return (
    <div
      id={`item-${it.id}`}
      tabIndex={0}
      onClick={() => onFocus(it.id)}
      onFocus={() => onFocus(it.id)}
      onKeyDown={e => { if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return; if (KEY_TO_STAGE[e.key]) setStage(KEY_TO_STAGE[e.key]); }}
      style={{
        padding: "12px 10px", borderBottom: `1px solid ${C.border}`, outline: "none",
        background: focused ? "rgba(255,255,255,0.03)" : "transparent",
        borderLeft: focused ? `2px solid ${BRAND.focus}` : "2px solid transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "2px 10px" }}>
        <span style={{ fontFamily: "monospace", color: C.dim, fontSize: 12 }}>{it.id}</span>
        <span style={{ fontWeight: 600, fontSize: 14, flex: "1 1 200px", minWidth: 0 }}>{it.title}</span>
        {!closed && it.status === "blocking" && (
          <span title="Holds up the permit submittal" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: STATUS.bad, border: `1px solid ${STATUS.bad}`, borderRadius: 4, padding: "1px 5px" }}>BLOCKING</span>
        )}
      </div>

      {closed
        ? it.resolution && <Md text={it.resolution} size={13} style={{ marginTop: 6, color: C.text }} />
        : (it.stands || fallback) && <Md text={it.stands || fallback} size={13} style={{ marginTop: 6, color: C.text }} />}

      {!closed && it.next?.who && (
        <div style={{ marginTop: 6, fontSize: 12, color: BRAND.link }}>
          Next: <b>{it.next.who}</b>{it.next.what ? `, ${it.next.what}` : ""}
          {it.next.since && <span style={{ color: C.dim }}> · since {md(it.next.since)}{waited ? ` (${plural(waited, "day", "days")})` : ""}</span>}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }} onClick={e => e.stopPropagation()}>
        <select value={stage} onChange={e => setStage(e.target.value)} aria-label={`Stage for ${it.id}`}
          title="Where this item stands. With the card selected, keys 1 to 4 move it."
          style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, background: C.bg, color: C.text, border: `1px solid ${C.border}`, cursor: "pointer" }}>
          {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button style={btn} onClick={() => toggle("details")}>{panel === "details" ? "Hide details" : "Details"}</button>
        {!closed && <button style={btn} onClick={() => toggle("edit")}>Update where it stands</button>}
        <button style={btn} onClick={() => toggle("note")}>Add note</button>
        {!closed && <button style={btn} onClick={() => toggle("draft")}>Draft reply</button>}
        {msg && <span style={{ fontSize: 12, color: STATUS.bad }}>{msg}</span>}
      </div>

      {panel === "details" && (
        <div style={{ marginTop: 10, paddingLeft: 10, borderLeft: `2px solid ${C.border}` }}>
          <div style={{ color: C.dim, fontSize: 11 }}>
            {[group, it.owner && `answer from ${it.owner}`, it.raised && `raised ${md(it.raised)}`, it.refs && `sheets ${it.refs}`].filter(Boolean).join(" · ")}
          </div>
          {it.concern && <Md text={it.concern} size={13} style={{ marginTop: 6, color: C.text }} />}
          {it.our_read && <Md text={`**Our read:** ${it.our_read}`} size={12} style={{ marginTop: 6, color: C.dim }} />}
          {it.ask && <Md text={`**The ask:** ${it.ask}`} size={12} style={{ marginTop: 6, color: C.dim }} />}
          {it.update && <Md text={`**Update:** ${it.update}`} size={12} style={{ marginTop: 6, color: C.dim }} />}
          {log.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.dim }}>History</div>
              {log.map((l, i) => (
                <div key={i} style={{ fontSize: 12, color: C.dim }}>
                  <span style={{ color: C.text }}>{md(l.ts)}</span> {l.who}: {String(l.note).replace(/^\d{1,2}\/\d{1,2}:\s*/, "")}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {panel === "edit" && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }} onClick={e => e.stopPropagation()}>
          <label style={{ fontSize: 11, color: C.dim }}>Where it stands (one sentence)
            <textarea value={stands} onChange={e => setStands(e.target.value)} rows={2} maxLength={400} style={{ ...field, resize: "vertical", marginTop: 3 }} />
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <label style={{ fontSize: 11, color: C.dim, flex: "1 1 140px" }}>Who moves next
              <input value={who} onChange={e => setWho(e.target.value)} maxLength={120} style={{ ...field, marginTop: 3 }} />
            </label>
            <label style={{ fontSize: 11, color: C.dim, flex: "3 1 220px" }}>To do what
              <input value={what} onChange={e => setWhat(e.target.value)} maxLength={300} style={{ ...field, marginTop: 3 }} />
            </label>
          </div>
          <div>
            <button disabled={saving} onClick={() => save({ stands: stands.trim(), next: who.trim() || what.trim() ? { who: who.trim(), what: what.trim() } : null })}
              style={{ ...btn, fontSize: 12, padding: "4px 12px", color: BRAND.link, border: `1px solid ${BRAND.border}` }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {panel === "note" && (
        <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="What happened, who said it…" style={{ ...field, resize: "vertical" }} />
          <button onClick={() => save({ note }, () => setNote(""))} disabled={saving || !note.trim()}
            style={{ ...btn, marginTop: 6, fontSize: 12, padding: "4px 12px", color: BRAND.link, border: `1px solid ${BRAND.border}` }}>
            {saving ? "Saving…" : "Save note"}
          </button>
        </div>
      )}

      {panel === "draft" && (
        <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
          <textarea readOnly value={draftReply(it)} rows={6} style={{ ...field, fontSize: 12, resize: "vertical" }} />
          <button onClick={() => { navigator.clipboard?.writeText(draftReply(it)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
            style={{ ...btn, marginTop: 6, fontSize: 12, padding: "4px 12px", color: BRAND.link, border: `1px solid ${BRAND.border}` }}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

function StageSection({ stage, rows, jobId, focusedId, onFocus, onPatch }) {
  return (
    <Section title={`${stage.label} (${rows.length})`}>
      <div style={{ color: C.dim, fontSize: 12, margin: "-8px 0 6px" }}>{stage.blurb}</div>
      {rows.map(({ it, group }) => (
        <Item key={it.id} it={it} group={group} jobId={jobId} focused={focusedId === it.id} onFocus={onFocus} onPatch={onPatch} />
      ))}
    </Section>
  );
}

export function RfiJob() {
  const { jobId } = useParams();
  const { hash } = useLocation();
  const [rfi, setRfi] = useState(null);
  const [err, setErr] = useState(null);
  const [focusedId, setFocusedId] = useState(null);
  const [closedOpen, setClosedOpen] = useState(false);
  const { lastMessage } = useWebSocket();

  const load = useCallback(() => {
    fetch(`/api/rfis/${jobId}`).then(async r => {
      if (r.status === 401) throw new Error("session expired");
      if (!r.ok) throw new Error((await r.json()).error || r.status);
      setRfi((await r.json()).data);
      setErr(null);
    }).catch(e => setErr(String(e.message || e)));
  }, [jobId]);

  useEffect(() => { Promise.resolve().then(load); }, [load]);
  useOnFocus(load);

  useEffect(() => {
    if (rfi && hash) setTimeout(() => { try { document.querySelector(hash)?.scrollIntoView({ block: "center" }); } catch { /* bad hash */ } }, 100);
  }, [rfi, hash]);

  useEffect(() => {
    if (lastMessage?.type === "rfi_update" && String(lastMessage.jobId) === String(jobId)) load();
  }, [lastMessage, jobId, load]);

  // Moving an item to Closed unmounts it into the collapsed section, so the next keypress would go
  // nowhere. Hand focus to the next open item instead. Other moves keep focus on the same card.
  const nextFocus = useRef(null);
  useEffect(() => {
    const id = nextFocus.current;
    if (!id) return;
    nextFocus.current = null;
    setFocusedId(id);
    document.getElementById(`item-${id}`)?.focus();
  }, [rfi]);

  // optimistic patch helper: patchItem(itemId, fields) mutates local state; patchItem(null,null,true) forces re-fetch
  const patchItem = (itemId, fields, forceReload) => {
    if (forceReload) { load(); return; }
    const all = (rfi?.groups || []).flatMap(g => g.items || []);
    if (itemId === focusedId) {
      if (fields?.stage === "closed") {
        const openIds = all.filter(it => stageOf(it) !== "closed").map(it => it.id);
        const i = openIds.indexOf(itemId);
        nextFocus.current = openIds[i + 1] || openIds[i - 1] || null;
      } else nextFocus.current = itemId;
    }
    setRfi(prev => {
      if (!prev) return prev;
      return { ...prev, groups: prev.groups.map(g => ({
        ...g, items: g.items.map(it => it.id === itemId ? { ...it, ...fields } : it),
      })) };
    });
  };

  if (err) return <Section title="RFIs"><div style={{ color: C.dim }}>{err}</div></Section>;
  if (!rfi) return <Section title="RFIs"><div style={{ color: C.dim }}>Loading…</div></Section>;

  const label = jobLabel(rfi);
  const rows = (rfi.groups || []).flatMap(g => (g.items || []).map(it => ({ it, group: g.name })));
  const byStage = Object.fromEntries(STAGES.map(s => [s.key, []]));
  for (const r of rows) byStage[stageOf(r.it)].push(r);
  // blocking first inside a stage, then file order
  for (const k of Object.keys(byStage)) byStage[k].sort((a, b) => (b.it.status === "blocking") - (a.it.status === "blocking"));
  const openCount = rows.length - byStage.closed.length;
  const blocking = rows.filter(r => stageOf(r.it) !== "closed" && r.it.status === "blocking").length;

  let hashId = hash ? hash.replace(/^#item-/, "") : "";
  try { hashId = decodeURIComponent(hashId); } catch { /* malformed escape: use it raw */ }
  // a link to a closed item has to open the Closed section or there is nothing to scroll to
  const hashClosed = byStage.closed.some(r => r.it.id === hashId);

  const summary = [
    `${openCount} open`,
    byStage.needs_answer.length && `${byStage.needs_answer.length} need${byStage.needs_answer.length === 1 ? "s" : ""} an answer`,
    byStage.our_move.length && `${byStage.our_move.length} our move`,
    byStage.agreed.length && `${byStage.agreed.length} agreed and waiting on drawings`,
  ].filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Link to="/rfis" style={{ color: BRAND.link, fontSize: 13, textDecoration: "none" }}>← all jobs</Link>
        <h2 style={{ margin: "6px 0 2px", fontSize: 18 }}>{label}</h2>
        <div style={{ color: C.dim, fontSize: 12 }}>{[rfi.address, rfi.issued_by && `issued by ${rfi.issued_by}`, rfi.revised && `revised ${md(rfi.revised)}`].filter(Boolean).join(" · ")}</div>
        <div style={{ color: C.text, fontSize: 13, marginTop: 6 }}>
          {summary[0]}{summary.length > 1 ? `: ${summary.slice(1).join(", ")}.` : "."}
          {blocking > 0 && <span style={{ color: STATUS.bad }}> {plural(blocking, "holds", "hold")} up the submittal.</span>}
        </div>
        <Drift jobLog={rfi.jobLog} revised={rfi.revised} />
      </div>

      {STAGES.filter(s => s.key !== "closed" && byStage[s.key].length).map(s => (
        <StageSection key={s.key} stage={s} rows={byStage[s.key]} jobId={jobId} focusedId={focusedId} onFocus={setFocusedId} onPatch={patchItem} />
      ))}

      {byStage.closed.length > 0 && (
        <details open={closedOpen || hashClosed} onToggle={e => setClosedOpen(e.currentTarget.open)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
          <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 700, color: C.bright }}>{stageLabel("closed")} ({byStage.closed.length})</summary>
          <div style={{ marginTop: 8 }}>
            {byStage.closed.map(({ it, group }) => (
              <Item key={it.id} it={it} group={group} jobId={jobId} focused={focusedId === it.id} onFocus={setFocusedId} onPatch={patchItem} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
