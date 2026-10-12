import { useCallback, useEffect, useMemo, useState } from "react";
import { C, BRAND, STATUS, crd, inn } from "../lib/colors";
import { useWebSocket } from "../hooks/useWebSocket";

// Apps — the App Builds page folded into Mission Control (Jake 2026-10-12: "the artifact is just a tab on
// this dashboard"). Same three files the claude.ai artifact renders (~/services/projects/app-builds/
// apps.json, status.json, data.json) via GET /api/apps, so the two can't drift. Patch text is fetched per
// PR from /api/apps/pr-files. The server pushes apps_update whenever a worker moves a step (roadmap.py),
// so the page follows the work without a reload. Read-only.

const STAGES = ["Idea", "Designed", "Building", "Testing", "In stores", "Selling"];
const LANES = { codex: "Codex", grok: "Grok", claude: "Claude", jake: "You" };
const TONE = {
  good: { bg: "rgba(111,208,47,0.14)", fg: STATUS.good },
  info: { bg: "rgba(108,195,223,0.14)", fg: "#6CC3DF" },
  brand: { bg: "rgba(122,178,255,0.16)", fg: BRAND.accent },
  warn: { bg: "rgba(240,179,74,0.16)", fg: STATUS.warn },
  bad: { bg: "rgba(255,143,133,0.14)", fg: STATUS.bad },
  off: { bg: "rgba(163,168,188,0.12)", fg: C.dim },
};
const STATE_TONE = {
  live: "good", done: "good", merged: "good",
  testing: "info", open: "info", review: "info",
  building: "brand", running: "brand", next: "brand", draft: "brand", jake: "brand",
  waiting: "warn",
  blocked: "bad", unmerged: "bad",
};
const LS_TAB = "mc-apps-tab";

const fmt = (d) => { if (!d) return ""; const [, m, dd] = String(d).slice(0, 10).split("-"); return `${+m}/${+dd}`; };
const ago = (stamp) => {
  const ms = Date.parse(stamp); if (!Number.isFinite(ms)) return "at an unknown time";
  const min = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.floor(min / 60)} h ago` : `${Math.floor(min / 1440)} d ago`;
};
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

function branchState(b) {
  if (b.has_pr) return ["open", "open PR"];
  if (b.ahead === 0) return ["clean", "merged, can delete"];
  if (b.merged_prs?.length) return ["merged", "merged #" + b.merged_prs.join(", #")];
  const days = (Date.now() - new Date(b.date)) / 864e5;
  return days > 21 ? ["stale", "old, no PR"] : ["unmerged", "no PR yet"];
}
const BRANCH_ORDER = { open: 0, unmerged: 1, merged: 2, stale: 3, clean: 4 };

function Chip({ state, label }) {
  const t = TONE[STATE_TONE[state] || "off"];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap", background: t.bg, color: t.fg, minWidth: 70, textAlign: "center", display: "inline-block" }}>
      {label ?? String(state).replace("-", " ")}
    </span>
  );
}

function Step({ r, appName }) {
  const meta = [r.when, r.note, r.updated ? "updated " + r.updated : ""].filter(Boolean).join(" · ");
  const mine = r.state === "jake";
  return (
    <li style={{ ...li, ...(mine ? { background: "rgba(122,178,255,0.06)", margin: "0 -8px", padding: "8px" } : null) }}>
      <Chip state={r.state} label={mine ? "your move" : r.state} />
      <span style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: C.bright, fontSize: 13 }}>
          {appName ? `${appName}: ` : ""}{r.step}
          <span style={{ fontSize: 10, color: C.dim, marginLeft: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{LANES[r.lane] || r.lane || ""}</span>
        </div>
        {(meta || r.pr) && (
          <div style={{ fontSize: 12, color: C.dim }}>
            {meta}{r.pr && <> {meta ? "· " : ""}<a href={r.pr} target="_blank" rel="noopener noreferrer" style={link}>PR</a></>}
          </div>
        )}
      </span>
    </li>
  );
}

function Channel({ c }) {
  const v = c.live;
  const checked = v ? (v.error ? `check failed ${ago(v.checked_at)}: ${v.error}` : `checked ${ago(v.checked_at)}`) : "from notes";
  return (
    <li style={li}>
      <Chip state={v ? v.state : c.state} />
      <span style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: C.bright, fontSize: 13 }}>{c.name}</div>
        <div style={{ fontSize: 12, color: C.dim }}>{v ? v.detail : c.note}</div>
        <div style={{ fontSize: 11, color: C.dim }}>{checked}</div>
      </span>
    </li>
  );
}

function Diff({ f }) {
  if (!f.patch) return <div style={cut}>{f.binary ? "Binary file" : "No text diff (file too large or renamed only)."}</div>;
  return (
    <>
      <pre style={{ margin: 0, overflowX: "auto", font: "12px/1.45 'JetBrains Mono',ui-monospace,monospace", background: C.card }}>
        {f.patch.split("\n").map((l, i) => {
          const s = l[0] === "+" ? { background: "#13301F", color: "#A6E6BF" } : l[0] === "-" ? { background: "#3A1818", color: "#F4B0B0" } : l.startsWith("@@") ? { color: "#A4B4D8", background: "rgba(163,168,188,0.12)" } : null;
          return <span key={i} style={{ display: "block", padding: "0 10px", whiteSpace: "pre", minWidth: "max-content", ...s }}>{l || " "}</span>;
        })}
      </pre>
      {f.cut ? <div style={cut}>{f.cut} more lines in this file on GitHub.</div> : null}
    </>
  );
}

function PrFiles({ p }) {
  const [files, setFiles] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  useEffect(() => {
    let alive = true;
    fetch(`/api/apps/pr-files?repo=${encodeURIComponent(p.repo)}&number=${p.number}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setFiles(d.files || []))
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [p.repo, p.number]);
  if (err) return <div style={cut}>Could not load the file list ({err}).</div>;
  if (!files) return <div style={cut}>Loading files…</div>;
  if (!files.length) return <div style={cut}>No file list.</div>;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {files.map((f, i) => (
        <div key={f.path + i} style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", minWidth: 0 }}>
          <button onClick={() => setOpen((o) => { const n = new Set(o); n.has(i) ? n.delete(i) : n.add(i); return n; })} aria-expanded={open.has(i)}
            style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, padding: "6px 10px", width: "100%", textAlign: "left", background: C.bg, border: 0, color: C.text, cursor: "pointer", font: "12px 'JetBrains Mono',ui-monospace,monospace" }}>
            <span style={{ overflowWrap: "anywhere", minWidth: 0 }}>{f.path}{f.status && f.status !== "modified" ? ` (${f.status})` : ""}</span>
            <Stat add={f.add} del={f.del} />
          </button>
          {open.has(i) && <Diff f={f} />}
        </div>
      ))}
      {p.more_files ? <div style={cut}>{p.more_files} more files on GitHub.</div> : null}
    </div>
  );
}

const Stat = ({ add, del }) => (
  <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
    <span style={{ color: STATUS.good }}>+{(add || 0).toLocaleString()}</span> <span style={{ color: STATUS.bad }}>−{(del || 0).toLocaleString()}</span>
  </span>
);

function PrRow({ p }) {
  const [open, setOpen] = useState(false);
  const label = p.state === "merged" ? "merged " + fmt(p.merged) : p.state;
  return (
    <div style={row}>
      <button className="rc-apps-rowh" onClick={() => setOpen(!open)} aria-expanded={open} style={rowH}>
        <Chip state={p.state} label={label} />
        <span style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: C.bright, fontSize: 13, overflowWrap: "anywhere" }}>{p.title}</div>
          <div style={{ fontSize: 11, color: C.dim, overflowWrap: "anywhere" }}>{p.repo} #{p.number} · {p.head} → {p.base}</div>
        </span>
        <Stat add={p.add} del={p.del} />
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px", display: "grid", gap: 10, minWidth: 0 }}>
          {p.summary && <p style={{ margin: 0, fontSize: 13, maxWidth: "72ch" }}>{p.summary}</p>}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
            <a href={`${p.url}/files`} target="_blank" rel="noopener noreferrer" style={link}>Full diff on GitHub</a>
            <a href={p.url} target="_blank" rel="noopener noreferrer" style={link}>PR conversation</a>
            <span style={{ color: C.dim }}>opened {fmt(p.created)}{p.merged ? " · merged " + fmt(p.merged) : ""} · {(p.file_count || 0) + (p.more_files || 0)} files</span>
          </div>
          <PrFiles p={p} />
        </div>
      )}
    </div>
  );
}

function BranchRow({ b }) {
  const [open, setOpen] = useState(false);
  const [st, label] = branchState(b);
  return (
    <div style={row}>
      <button className="rc-apps-rowh" onClick={() => setOpen(!open)} aria-expanded={open} style={rowH}>
        <Chip state={st} label={label} />
        <span style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: C.bright, fontSize: 13, overflowWrap: "anywhere" }}>{b.name}</div>
          <div style={{ fontSize: 11, color: C.dim }}>{b.repo} · last commit {fmt(b.date)}</div>
        </span>
        <span style={{ fontSize: 12, color: C.dim, whiteSpace: "nowrap" }}>{b.ahead} ahead · {b.behind} behind</span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px", display: "grid", gap: 8 }}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", font: "12px 'JetBrains Mono',ui-monospace,monospace", display: "grid", gap: 3 }}>
            {(b.commits || []).map((c) => <li key={c.sha}><span style={{ color: C.dim }}>{c.sha} {fmt(c.date)}</span> {c.msg}</li>)}
            {!(b.commits || []).length && <li style={{ color: C.dim }}>No commits that main lacks.</li>}
          </ul>
          {b.url && <a href={b.url} target="_blank" rel="noopener noreferrer" style={{ ...link, fontSize: 12 }}>Compare with main on GitHub</a>}
        </div>
      )}
    </div>
  );
}

export default function AppBuildsView() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [cur, setCur] = useState(() => lsGet(LS_TAB));
  const [q, setQ] = useState("");

  const load = useCallback(() => fetch("/api/apps")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d) => { setData(d); setErr(null); })
    .catch((e) => setErr(e.message)), []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  const ws = useWebSocket();
  useEffect(() => { if (ws.lastMessage?.type === "apps_update") load(); }, [ws.lastMessage, load]);

  // status.json carries the live channel checks, keyed "<appId>/<channel name>"; apps.json is the fresher roadmap.
  const apps = useMemo(() => (data?.apps || []).map((a) => ({
    ...a, channels: (a.channels || []).map((c) => ({ ...c, live: data?.status?.channels?.[`${a.id}/${c.name}`] || c.live || null })),
  })), [data]);
  const app = apps.find((a) => a.id === cur) || apps[0];
  const pick = (id) => { setCur(id); lsSet(LS_TAB, id); };

  const mine = useMemo(() => apps.flatMap((a) => (a.roadmap || [])
    .filter((r) => (r.lane === "jake" || r.state === "jake") && r.state !== "done" && r.state !== "later").map((r) => [a, r])), [apps]);
  const prs = (data?.prs || []).filter((p) => p.app === app?.id);
  const openPrs = prs.filter((p) => p.state !== "merged");
  const merged = prs.filter((p) => p.state === "merged").sort((a, b) => String(b.merged).localeCompare(String(a.merged)) || b.number - a.number);
  const shown = q.trim() ? merged.filter((p) => (p.title + " " + p.head).toLowerCase().includes(q.toLowerCase())) : merged;
  const branches = (data?.branches || []).filter((b) => b.app === app?.id)
    .sort((a, b) => BRANCH_ORDER[branchState(a)[0]] - BRANCH_ORDER[branchState(b)[0]] || String(b.date).localeCompare(String(a.date)));
  const si = app ? STAGES.indexOf(app.stage) : -1;

  if (!data) return <div style={crd}><div style={{ padding: 22, color: C.dim, fontSize: 13 }}>{err ? `Could not load App Builds (${err}).` : "Loading roadmap, branches and PRs…"}</div></div>;

  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.bright, margin: 0 }}>Apps</h2>
          <div style={{ fontSize: 12, color: C.dim }}>Pulled from GitHub {data.generated}. Workers move the roadmap steps, so this page follows the work.</div>
        </div>
        <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {apps.map((a) => {
            const on = a.id === app?.id;
            const n = (data.prs || []).filter((p) => p.app === a.id && p.state !== "merged").length;
            return (
              <button key={a.id} role="tab" aria-selected={on} onClick={() => pick(a.id)}
                style={{ fontSize: 13, fontWeight: 600, padding: "7px 12px", borderRadius: 8, cursor: "pointer", border: `1px solid ${on ? BRAND.border : C.border}`, background: on ? "rgba(122,178,255,0.16)" : C.card, color: on ? BRAND.focus : C.text }}>
                {a.name} <span style={{ fontSize: 11, color: C.dim }}>{n} open</span>
              </button>
            );
          })}
        </div>
      </div>
      {err && <div style={{ fontSize: 12, color: STATUS.warn }}>Last refresh failed ({err}). Showing the previous copy.</div>}
      {data.errors?.length ? <div style={{ fontSize: 12, color: STATUS.warn }}>Could not read {data.errors.map((e) => e.file).join(", ")}.</div> : null}

      <div style={crd}>
        <h3 style={h3}>Launch <small style={small}>Every step has an owner.</small></h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          {apps.map((a) => {
            const live = (a.roadmap || []).filter((r) => r.state !== "later");
            const done = live.filter((r) => r.state === "done").length;
            const run = live.filter((r) => ["running", "building"].includes(r.state)).length;
            return (
              <div key={a.id} style={{ ...inn, padding: "10px 12px", minWidth: 0 }}>
                <b style={{ color: C.bright, fontSize: 13 }}>{a.name}</b>
                <div style={{ height: 6, borderRadius: 3, background: "rgba(163,168,188,0.12)", margin: "6px 0", overflow: "hidden" }}>
                  <i style={{ display: "block", height: "100%", width: `${live.length ? Math.round((100 * done) / live.length) : 0}%`, background: STATUS.good }} />
                </div>
                <div style={{ fontSize: 12, color: C.dim }}>{done} of {live.length} done{run ? `, ${run} being worked` : ""}</div>
                {a.launch && <div style={{ fontSize: 12, color: C.dim }}>{a.launch}</div>}
              </div>
            );
          })}
        </div>
        <h3 style={{ ...h3, marginTop: 16 }}>Your moves <small style={small}>{mine.length} only you can do</small></h3>
        <ul style={ul}>
          {mine.map(([a, r]) => <Step key={a.id + r.step} r={r} appName={a.name} />)}
          {!mine.length && <li style={{ color: C.dim, fontSize: 13 }}>Nothing waiting on you.</li>}
        </ul>
      </div>

      {app && (
        <>
          <div style={crd}>
            <p style={{ margin: 0, fontSize: 14, color: C.bright }}>{app.what}</p>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: C.dim }}>{app.status}</p>
            <div className="rc-apps-stages" style={{ display: "grid", gap: 4, marginTop: 14 }}>
              {STAGES.map((s, i) => (
                <div key={s} style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center", padding: "6px 2px", borderRadius: 4,
                  background: i === si ? BRAND.border : i < si ? "rgba(122,178,255,0.16)" : "rgba(163,168,188,0.12)", color: i === si ? C.bg : i < si ? BRAND.accent : C.dim }}>{s}</div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
            <div style={crd}>
              <h3 style={h3}>Roadmap {app.launch && <small style={small}>Target: {app.launch}</small>}</h3>
              <ul style={ul}>{(app.roadmap || []).map((r, i) => <Step key={i + r.step} r={r} />)}</ul>
            </div>
            <div style={crd}>
              <h3 style={h3}>Where it ships</h3>
              <ul style={ul}>{(app.channels || []).map((c) => <Channel key={c.name} c={c} />)}</ul>
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <h3 style={h3}>Open work <small style={small}>{openPrs.length} open PR{openPrs.length === 1 ? "" : "s"}. Tap one to read what changed.</small></h3>
            {openPrs.map((p) => <PrRow key={p.repo + p.number} p={p} />)}
            {!openPrs.length && <div style={{ color: C.dim, fontSize: 13 }}>No open PRs.</div>}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <h3 style={h3}>Branches <small style={small}>Everything not on main yet, newest first.</small></h3>
            {branches.map((b) => <BranchRow key={b.repo + b.name} b={b} />)}
            {!branches.length && <div style={{ color: C.dim, fontSize: 13 }}>No side branches.</div>}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <h3 style={h3}>Shipped <small style={small}>{merged.length} merged since {fmt(data.since)}</small></h3>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title or branch" aria-label="Filter shipped PRs"
              style={{ fontSize: 13, padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.bright, outline: "none", maxWidth: 420 }} />
            {shown.map((p, i) => {
              const head = i === 0 || shown[i - 1].merged !== p.merged ? p.merged : null;
              return (
                <div key={p.repo + p.number} style={{ display: "grid", gap: 6 }}>
                  {head && <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: C.dim, marginTop: 6 }}>{new Date(head + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>}
                  <PrRow p={p} />
                </div>
              );
            })}
            {!shown.length && <div style={{ color: C.dim, fontSize: 13 }}>{q ? "No match." : "Nothing merged in this window."}</div>}
          </div>
        </>
      )}
    </div>
  );
}

const ul = { display: "grid", margin: 0, padding: 0, listStyle: "none" };
const li = { display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.border}`, alignItems: "start", minWidth: 0 };
const row = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, minWidth: 0 };
const rowH = { display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", padding: "10px 14px", cursor: "pointer", width: "100%", textAlign: "left", background: "none", border: 0, color: "inherit", font: "inherit" };
const link = { color: BRAND.link };
const cut = { fontSize: 12, color: C.dim, padding: "6px 10px" };
const h3 = { fontSize: 15, fontWeight: 700, color: C.bright, margin: "0 0 8px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" };
const small = { fontSize: 12, fontWeight: 400, color: C.dim };
