// Skills (2026-08-23): every SKILL.md an agent on this box can load, in one place, grouped
// by the area that loads it — Claude Code on the host (git source of truth + ~/.claude
// symlinks), Paperclip, The Claw's main + per-agent workspaces, and the two read-only sets
// (OpenClaw bundled, the anthropic-skills plugin). Click a skill to read it, edit it in
// place (claude-code saves commit in ~/services), copy it to other areas, or compose a new
// one and deploy it to the areas it belongs in. Jake, 8/23: "bring the skills for each
// area to one spot ... build skills right on the dashboard and disburse them".
// Roots, validation, and writes live in server/lib/skills.js; this file is only the UI.
import { useState, useEffect, useCallback, useMemo } from "react";
import { C, BRAND, STATUS } from "../lib/colors";
import { btnS } from "../lib/helpers";
import { Section } from "../components/ui/Card";
import { useWebSocket } from "../hooks/useWebSocket";

const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const WFA = { area: "claude-code", name: "writing-for-agents" };

const TEMPLATE = `# Title

One sentence: what this skill does and the situation it is for.

## Steps

1. First step. Ends when: <a condition the agent can check>.
2. Next step. Ends when: <...>.

## Reference

Rules and facts the steps consult on demand. Anything only some branches need goes in a
sibling file next to this one, reached by a pointer here.
`;

function ago(iso) {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

const inputS = {
  fontSize: 13, padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
  background: C.bg, color: C.text, fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};
const monoS = { ...inputS, fontFamily: MONO, fontSize: 12, lineHeight: 1.5, resize: "vertical" };
const pillS = (tone) => ({
  fontSize: 10, padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap", fontWeight: 600,
  background: tone === "warn" ? "rgba(217,169,59,0.12)" : "rgba(255,255,255,0.05)",
  border: `1px solid ${tone === "warn" ? "rgba(217,169,59,0.4)" : "rgba(255,255,255,0.12)"}`,
  color: tone === "warn" ? STATUS.warn : C.dim,
});
const noteS = { fontSize: 12, color: C.text, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8, whiteSpace: "pre-wrap" };

const WARN_FLAGS = new Set(["local only", "not linked", "broken link", "off"]);
const Pill = ({ text }) => <span style={pillS(WARN_FLAGS.has(text) ? "warn" : "")}>{text}</span>;

function describeResults(results, areas) {
  const label = (id) => areas.find((a) => a.id === id)?.label || id;
  return results.map((r) => {
    if (!r.ok) return `✗ ${label(r.area)}: ${r.error}`;
    const bits = [r.message || "written", r.path];
    if (r.link) bits.push(r.link === "linked" ? "~/.claude/skills symlink created" : r.link);
    if (r.linkError) bits.push(`link failed: ${r.linkError}`);
    if (r.commit) bits.push(`committed ${r.commit} in ~/services`);
    if (r.commitError) bits.push(`commit failed: ${r.commitError}`);
    return `✓ ${label(r.area)}: ${bits.join(" · ")}`;
  }).join("\n");
}

// ── one skill, expanded: read / edit / copy ──────────────────────────────────
function SkillDetail({ area, skill, areas, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState([]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/skills/${area.id}/${skill.name}`);
      const body = await r.json();
      if (!body.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setDoc(body.data);
      setDraft(body.data.content);
    } catch (e) { setErr(e.message); }
  }, [area.id, skill.name]);
  useEffect(() => { load(); }, [load]);

  const dirty = doc && draft !== doc.content;
  const rows = Math.min(40, Math.max(8, (draft.match(/\n/g) || []).length + 2));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/skills/${area.id}/${skill.name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: draft }) });
      const body = await r.json();
      if (!body.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setMsg(body.message);
      setDoc((d) => ({ ...d, content: draft }));
      onChanged?.();
    } catch (e) { setMsg(`Save failed: ${e.message}`); }
    finally { setBusy(false); }
  };

  // Other writable areas this skill could be copied into, with "already there" marked.
  const copyTargets = areas.filter((a) => a.writable && a.id !== area.id)
    .map((a) => ({ ...a, has: a.skills.some((s) => s.name === skill.name) }));
  const copy = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/skills/${area.id}/${skill.name}/copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ areas: targets }) });
      const body = await r.json();
      if (!body.ok && !body.results) throw new Error(body.error || `HTTP ${r.status}`);
      setMsg(describeResults(body.results, areas));
      setTargets([]);
      onChanged?.();
    } catch (e) { setMsg(`Copy failed: ${e.message}`); }
    finally { setBusy(false); }
  };

  if (err) return <div style={{ ...noteS, marginTop: 8 }}>{err}</div>;
  if (!doc) return <div style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>Loading…</div>;
  const editable = doc.writable;
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, cursor: "default" }}>
      <div style={{ fontSize: 11, color: C.dim, fontFamily: MONO, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>{doc.path}</span>
        <span>modified {when(skill.mtime)}</span>
        <span>{kb(skill.size)}</span>
        {doc.git && <span>git: ~/services</span>}
      </div>
      {skill.extraFiles?.length > 0 && (
        <div style={{ fontSize: 11, color: C.dim }}>
          Also in this skill's folder (not editable here): <span style={{ fontFamily: MONO }}>{skill.extraFiles.join(", ")}</span>
        </div>
      )}
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={rows} readOnly={!editable} spellCheck={false}
        style={{ ...monoS, opacity: editable ? 1 : 0.85 }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {editable ? (
          <>
            <button style={btnS(true)} disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : doc.git ? "Save + commit" : "Save"}</button>
            <button style={btnS(false)} disabled={!dirty || busy} onClick={() => setDraft(doc.content)}>Revert</button>
            {dirty && <span style={{ fontSize: 11, color: STATUS.warn }}>unsaved</span>}
          </>
        ) : (
          <span style={{ fontSize: 11, color: C.dim }}>Read-only: {area.note}</span>
        )}
      </div>
      {copyTargets.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Copy to</span>
          {copyTargets.map((t) => (
            <label key={t.id} style={{ fontSize: 12, color: t.has ? C.dim : C.text, display: "flex", alignItems: "center", gap: 5 }} title={t.has ? "already deployed there" : t.root}>
              <input type="checkbox" disabled={t.has || busy} checked={targets.includes(t.id)}
                onChange={(e) => setTargets((x) => (e.target.checked ? [...x, t.id] : x.filter((i) => i !== t.id)))} />
              {t.label}{t.has ? " ✓" : ""}
            </label>
          ))}
          <button style={btnS(false)} disabled={!targets.length || busy} onClick={copy}>{busy ? "Copying…" : "Copy"}</button>
        </div>
      )}
      {msg && <div style={noteS}>{msg}</div>}
    </div>
  );
}

// ── one row ──────────────────────────────────────────────────────────────────
function SkillRow({ area, skill, elsewhere, open, onToggle, areas, onChanged }) {
  const desc = (skill.description || "").replace(/\s+/g, " ").trim();
  return (
    <div id={`skill-${area.id}-${skill.name}`} role="button" tabIndex={0} onClick={onToggle}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(); } }}
      style={{ padding: "9px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: open ? BRAND.focus : C.bright }}>{skill.name}</span>
        {(skill.flags || []).map((f) => <Pill key={f} text={f} />)}
        <span title={desc} style={{ flex: "1 1 260px", minWidth: 0, fontSize: 12, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: open ? "normal" : "nowrap" }}>
          {desc || <em>no description in frontmatter</em>}
        </span>
        {elsewhere.length > 0 && (
          <span style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }} title="the same skill name in other areas">
            also: {elsewhere.map((e) => `${e.label}${e.same ? "" : " (differs)"}`).join(", ")}
          </span>
        )}
        <span style={{ fontSize: 11, color: C.dim, fontFamily: MONO, whiteSpace: "nowrap" }} title={when(skill.mtime)}>{ago(skill.mtime)}</span>
      </div>
      {open && <SkillDetail area={area} skill={skill} areas={areas} onChanged={onChanged} />}
    </div>
  );
}

// ── one area ─────────────────────────────────────────────────────────────────
function AreaSection({ area, areas, index, open, setOpen, onChanged }) {
  const [show, setShow] = useState(!area.collapsed);
  const n = area.skills.length;
  return (
    <Section title={area.label}>
      <div style={{ fontSize: 11, color: C.dim, fontFamily: MONO, marginTop: -8, marginBottom: 4, wordBreak: "break-all" }}>{area.root}</div>
      <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>{area.note}</div>
      {area.error && <div style={{ ...noteS, color: STATUS.bad }}>{area.error}</div>}
      {!area.error && n === 0 && (
        <div style={{ fontSize: 13, color: C.dim }}>{area.exists ? "No skills here yet." : "No skills here yet (the folder does not exist; deploying a skill creates it)."}</div>
      )}
      {n > 0 && !show && <button style={btnS(false)} onClick={() => setShow(true)}>Show {n} skills</button>}
      {n > 0 && show && area.skills.map((s) => {
        const key = `${area.id}/${s.name}`;
        const elsewhere = (index.get(s.name) || []).filter((e) => e.area !== area.id).map((e) => ({ ...e, same: e.hash === s.hash }));
        return <SkillRow key={key} area={area} skill={s} areas={areas} elsewhere={elsewhere} open={open === key} onToggle={() => setOpen(open === key ? null : key)} onChanged={onChanged} />;
      })}
      {n > 0 && show && area.collapsed && <button style={{ ...btnS(false), marginTop: 8 }} onClick={() => setShow(false)}>Hide</button>}
    </Section>
  );
}

// ── composer ─────────────────────────────────────────────────────────────────
function Composer({ areas, onCreated, onClose, openWfa }) {
  const writable = areas.filter((a) => a.writable);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState(TEMPLATE);
  const [targets, setTargets] = useState(["claude-code"]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const nameOk = NAME_RE.test(name);
  const taken = writable.filter((a) => targets.includes(a.id) && a.skills.some((s) => s.name === name)).map((a) => a.label);
  const canCreate = nameOk && description.trim() && body.trim() && targets.length > 0 && taken.length === 0 && !busy;

  const create = async () => {
    setBusy(true); setResult(null);
    try {
      const r = await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, body, areas: targets }) });
      const data = await r.json();
      if (!data.ok && !data.results) throw new Error(data.error || `HTTP ${r.status}`);
      setResult(describeResults(data.results, areas));
      if (data.ok) onCreated?.(name, data.results.find((x) => x.ok)?.area);
    } catch (e) { setResult(`Create failed: ${e.message}`); }
    finally { setBusy(false); }
  };

  const label = { fontSize: 12, color: C.text, display: "flex", flexDirection: "column", gap: 4 };
  const hint = { color: C.dim, fontSize: 11 };
  return (
    <Section title="New skill">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 12, color: C.dim }}>
          One SKILL.md, written with frontmatter (name + description) to every area you tick. Follow{" "}
          <a href="#writing-for-agents" onClick={(e) => { e.preventDefault(); openWfa(); }} style={{ color: BRAND.link, fontWeight: 600 }}>writing-for-agents</a>
          : the description is the trigger — say what it is, then when to use it, one trigger per branch; the body is ordered steps, each ending on a condition the agent can check.
        </div>
        <label style={label}>
          <span>Name <span style={hint}>kebab-case, becomes the folder name</span></span>
          <input value={name} onChange={(e) => setName(e.target.value.trim().toLowerCase())} placeholder="pay-app-review" style={{ ...inputS, fontFamily: MONO, maxWidth: 360, borderColor: name && !nameOk ? STATUS.bad : C.border }} />
          {name && !nameOk && <span style={{ ...hint, color: STATUS.bad }}>lowercase letters, digits and single dashes only (no leading/trailing dash)</span>}
          {taken.length > 0 && <span style={{ ...hint, color: STATUS.warn }}>already exists in {taken.join(", ")} — open it there to edit, or pick another name</span>}
        </label>
        <label style={label}>
          <span>Description <span style={hint}>what it is + "Use whenever …" — this is all the agent sees before it decides to load the skill</span></span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...inputS, resize: "vertical" }}
            placeholder="Review a JobTread pay app against the SOV before it goes out. Use whenever Jake says 'check this pay app' or a G702 is about to be finalized." />
        </label>
        <label style={label}>
          <span>Body <span style={hint}>markdown; the frontmatter is added for you</span></span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} spellCheck={false} style={monoS} />
        </label>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
          <span style={{ fontWeight: 600, color: C.text }}>Deploy to</span>
          {writable.map((a) => (
            <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 5, color: C.text }} title={a.root}>
              <input type="checkbox" checked={targets.includes(a.id)} onChange={(e) => setTargets((t) => (e.target.checked ? [...t, a.id] : t.filter((i) => i !== a.id)))} />
              {a.label}
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={btnS(true)} disabled={!canCreate} onClick={create}>{busy ? "Writing…" : "Create"}</button>
          <button style={btnS(false)} disabled={busy} onClick={onClose}>Close</button>
        </div>
        {result && <div style={noteS}>{result}</div>}
      </div>
    </Section>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function SkillsView() {
  const [areas, setAreas] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [composing, setComposing] = useState(false);
  const { lastMessage } = useWebSocket();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/skills");
      if (r.status === 401) { setErr("session expired"); return; }
      const body = await r.json();
      if (!body.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setAreas(body.data);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (lastMessage?.type === "skills_update") load(); }, [lastMessage, load]);

  // name → every area carrying it (drives the "also: …" column)
  const index = useMemo(() => {
    const m = new Map();
    for (const a of areas || []) for (const s of a.skills) {
      if (!m.has(s.name)) m.set(s.name, []);
      m.get(s.name).push({ area: a.id, label: a.label.replace(/ \(.*\)$/, ""), hash: s.hash });
    }
    return m;
  }, [areas]);

  const openSkill = (areaId, name) => {
    setOpen(`${areaId}/${name}`);
    setTimeout(() => document.getElementById(`skill-${areaId}-${name}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const hasWfa = areas?.find((a) => a.id === WFA.area)?.skills.some((s) => s.name === WFA.name);

  if (err) return <Section title="Skills"><div style={{ color: C.dim }}>{err}</div></Section>;
  if (!areas) return <Section title="Skills"><div style={{ color: C.dim }}>Loading…</div></Section>;

  const total = areas.reduce((n, a) => n + a.skills.length, 0);
  const editable = areas.filter((a) => a.writable).reduce((n, a) => n + a.skills.length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Skills">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.dim }}>
            {total} skills across {areas.length} areas, {editable} editable. Click a skill to read it, edit it in place, or copy it to another area.
            "also:" means the same skill name exists elsewhere; "(differs)" means the files are not identical.
          </span>
          <span style={{ flex: 1 }} />
          <button style={btnS(true)} onClick={() => { setComposing(true); setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0); }}>New skill</button>
          <button style={btnS(false)} onClick={load}>Refresh</button>
        </div>
      </Section>
      {composing && (
        <Composer areas={areas} onClose={() => setComposing(false)}
          openWfa={() => hasWfa && openSkill(WFA.area, WFA.name)}
          onCreated={(name, areaId) => { load().then(() => areaId && openSkill(areaId, name)); }} />
      )}
      {areas.map((a) => (
        <AreaSection key={a.id} area={a} areas={areas} index={index} open={open} setOpen={setOpen} onChanged={load} />
      ))}
    </div>
  );
}
