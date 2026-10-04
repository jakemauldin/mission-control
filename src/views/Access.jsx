// Access map (/access): click through every credential, service connection, cron and
// Bitwarden account on this box. Reads GET /api/access-map (server/lib/accessmap.js), which
// serves ~/.local/share/access-map/latest.json written by scripts/access-map.py. Contract:
// docs/access-map-schema.md in the services repo. No secret VALUE is ever in that file, only
// an 8-hex HMAC fingerprint, so two stores holding the same key show the same fingerprint.
//
// Tolerance rules (the schema promises them): unknown enum values render as raw text, missing
// fields render "—", a missing array is an empty one, unknown extra fields are visible under
// "raw record" in every detail panel. A cron and its consumer can share one id (the schema's
// own example does), so every link carries a kind hint and the URL always carries the tab.
//
// Selection lives in the URL: /access?tab=credentials&item=<id>. Back button works, links share.
import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { C, BRAND, STATUS, crd, inn } from "../lib/colors";
import { btnS } from "../lib/helpers";
import { Section } from "../components/ui/Card";

const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const TABS = [
  { key: "services", label: "Services" },
  { key: "credentials", label: "Credentials" },
  { key: "crons", label: "Crons" },
  { key: "consumers", label: "Consumers" },
  { key: "bitwarden", label: "Bitwarden" },
];
const STALE_REVIEW_DAYS = 14;
const PAGE = 150; // rows rendered before "show more" (Bitwarden alone can be 600 sites)

// ── tiny helpers ──────────────────────────────────────────────
const arr = (x) => (Array.isArray(x) ? x : []);
const objs = (x) => arr(x).filter((o) => o && typeof o === "object");
const has = (x) => x != null && x !== "";
const uniq = (list) => [...new Set(list)];
const cmpStr = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
const show = (x) => {
  if (x == null || x === "") return "—";
  if (typeof x === "object") { try { return JSON.stringify(x); } catch { return "—"; } }
  return String(x);
};
// Every field in `fields` (arrays flattened) must contain every word typed.
const match = (q, ...fields) => {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.flat(Infinity).filter(has).map(String).join("\n").toLowerCase();
  return words.every((w) => hay.includes(w));
};

const toMs = (iso) => {
  if (!has(iso)) return null;
  const s = String(iso);
  const t = new Date(s.length <= 10 ? `${s}T12:00:00` : s).getTime();
  return Number.isFinite(t) ? t : null;
};
const fmtAbs = (iso) => {
  const t = toMs(iso);
  if (t == null) return show(iso);
  const s = String(iso);
  return s.length <= 10 ? s : new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};
const fmtRel = (iso, now) => {
  const t = toMs(iso);
  if (t == null) return "";
  const d = t - now;
  const a = Math.abs(d);
  if (a < 60e3) return "just now";
  const [div, unit] = a < 3600e3 ? [60e3, "m"] : a < 48 * 3600e3 ? [3600e3, "h"] : [86400e3, "d"];
  const n = Math.floor(a / div);
  return d < 0 ? `${n}${unit} ago` : `in ${n}${unit}`;
};

// ── status + severity vocabulary ──────────────────────────────
// ok green · expiring/stale/drift amber · expired/failing/empty red · unused/unknown grey.
const STATUS_TONE = { ok: "good", expiring: "warn", stale: "warn", drift: "warn", expired: "bad", failing: "bad", empty: "bad", unused: "mute", unknown: "mute" };
// "worst" for a service: red > amber > unknown > ok > unused. Unknown values rank like unknown.
const STATUS_RANK = { failing: 9, expired: 8, empty: 7, drift: 6, expiring: 5, stale: 4, unknown: 2, ok: 1, unused: 0.5 };
const rankOf = (s) => STATUS_RANK[s] ?? 2;
const SEV_TONE = { high: "bad", medium: "warn", low: "info" };
const SEV_ORDER = ["high", "medium", "low"];
const sevRank = (s) => { const i = SEV_ORDER.indexOf(s); return i < 0 ? SEV_ORDER.length : i; };
const VIA_ORDER = ["mcp", "connector", "api", "oauth", "n8n-credential", "browser-session", "webhook", "cli"];
const VIA_LABEL = { mcp: "MCP", connector: "Connector", api: "API", oauth: "OAuth", "n8n-credential": "n8n credential", "browser-session": "Browser session", webhook: "Webhook", cli: "CLI" };
const KIND_ORDER = ["container", "systemd", "host-script", "cron", "n8n-workflow", "mcp-server", "openclaw", "connector", "claude-config"];
const WHERE_ORDER = ["host crontab", "openclaw internal", "n8n local", "n8n cloud", "systemd timer", "claude scheduled task"];

const TONES = {
  bad: { bg: "rgba(220,38,38,0.12)", bd: "rgba(220,38,38,0.4)", fg: "#FCA5A5" },
  warn: { bg: "rgba(217,169,59,0.12)", bd: "rgba(217,169,59,0.4)", fg: STATUS.warn },
  good: { bg: "rgba(42,157,143,0.12)", bd: "rgba(42,157,143,0.35)", fg: "#A7F3D0" },
  info: { bg: "rgba(96,165,250,0.10)", bd: "rgba(96,165,250,0.35)", fg: "#93C5FD" },
  mute: { bg: "rgba(255,255,255,0.05)", bd: "rgba(255,255,255,0.12)", fg: C.dim },
};
const chipS = (tone = "mute") => {
  const t = TONES[tone] || TONES.mute;
  return { fontSize: 10, padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap", fontWeight: 600, background: t.bg, border: `1px solid ${t.bd}`, color: t.fg };
};
const noteS = { fontSize: 12, color: C.text, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8, whiteSpace: "pre-wrap" };
const linkS = { color: BRAND.link, textDecoration: "none", fontWeight: 600 };
const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const thS = { textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: C.dim, fontWeight: 600, padding: "4px 8px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
const tdS = { fontSize: 12, padding: "6px 8px", borderBottom: `1px solid ${C.border}`, verticalAlign: "top", color: C.text };
const bareBtn = { background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" };

const Chip = ({ tone, title, children, style }) => <span title={title} style={{ ...chipS(tone), ...style }}>{children}</span>;
const StatusBadge = ({ status, detail }) => <Chip tone={STATUS_TONE[status] || "mute"} title={has(detail) ? String(detail) : undefined}>{has(status) ? String(status) : "—"}</Chip>;
const SevBadge = ({ sev }) => <Chip tone={SEV_TONE[sev] || "mute"}>{has(sev) ? String(sev) : "—"}</Chip>;

// ── hooks ─────────────────────────────────────────────────────
function useNarrow(px = 900) {
  const query = `(max-width: ${px - 1}px)`;
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return narrow;
}
function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// ── the index: every lookup the panels need, built once per data load ──
function buildIndex(data) {
  const d = data && typeof data === "object" ? data : {};
  const services = objs(d.services), credentials = objs(d.credentials), consumers = objs(d.consumers);
  const connections = objs(d.connections), crons = objs(d.crons), findings = objs(d.findings);
  const bw = d.bitwarden && typeof d.bitwarden === "object" ? d.bitwarden : null;
  const sites = objs(bw?.sites), machines = objs(bw?.machineAccounts), identities = objs(bw?.identities);

  const byId = (list) => new Map(list.filter((x) => has(x.id)).map((x) => [String(x.id), x]));
  const maps = {
    service: byId(services), credential: byId(credentials), consumer: byId(consumers), cron: byId(crons),
    connection: byId(connections), finding: byId(findings),
    site: new Map(sites.filter((x) => has(x.site)).map((x) => [String(x.site), x])),
    machine: new Map(machines.filter((x) => has(x.name)).map((x) => [String(x.name), x])),
  };
  const TAB = { service: "services", credential: "credentials", consumer: "consumers", cron: "crons", site: "bitwarden" };
  const ORDER = ["service", "credential", "cron", "consumer", "connection", "site", "machine", "finding"];
  const nameCount = new Map();
  for (const c of credentials) nameCount.set(c.name, (nameCount.get(c.name) || 0) + 1);
  const credLabel = (c, key) => (nameCount.get(c.name) > 1 ? `${show(c.name ?? key)} [${show(c.store)}]` : show(c.name ?? key));
  const nameOf = (kind, id) => { const o = maps[kind].get(String(id)); return o ? show(o.name ?? o.site ?? o.id) : show(id); };

  // id (+ optional kind hint) -> where it lives. Hint wins; otherwise the first kind that has it.
  const resolve = (id, kind) => {
    if (!has(id)) return null;
    const key = String(id);
    for (const k of kind ? [kind, ...ORDER.filter((x) => x !== kind)] : ORDER) {
      const o = maps[k].get(key);
      if (!o) continue;
      if (k === "finding") return { kind: k, obj: o, finding: true, label: show(o.title ?? key) };
      if (k === "machine") return { kind: k, obj: o, tab: "bitwarden", item: null, label: key };
      if (k === "connection") return { kind: k, obj: o, tab: "services", item: String(o.to), label: `${nameOf("consumer", o.from)} → ${nameOf("service", o.to)}` };
      return { kind: k, obj: o, tab: TAB[k], item: key, label: k === "site" ? key : k === "credential" ? credLabel(o, key) : show(o.name ?? key) };
    }
    return null;
  };

  const idsOf = (list) => uniq(list.filter(has).map(String));
  const findingsByRef = new Map();
  for (const f of findings) for (const r of arr(f.refs)) { const k = String(r); if (!findingsByRef.has(k)) findingsByRef.set(k, []); findingsByRef.get(k).push(f); }
  const dupGroups = new Map();
  for (const c of credentials) if (has(c.dupGroup)) { const k = String(c.dupGroup); if (!dupGroups.has(k)) dupGroups.set(k, []); dupGroups.get(k).push(c); }

  return {
    services, credentials, consumers, connections, crons, findings, sites, machines, identities, bw, maps, dupGroups, resolve, nameOf,
    // an item's findings: the ones it lists plus any finding that names it in refs
    findingsOf: (item) => uniq([
      ...arr(item.findingIds).map((id) => maps.finding.get(String(id))).filter(Boolean),
      ...(findingsByRef.get(String(item.id ?? item.site ?? item.name)) || []),
    ]),
    credsOfService: (s) => idsOf([...arr(s.credentialIds), ...credentials.filter((c) => c.serviceId === s.id).map((c) => c.id)]),
    connsOfService: (s) => uniq([...arr(s.connectionIds).map((id) => maps.connection.get(String(id))).filter(Boolean), ...connections.filter((c) => c.to === s.id)]),
    sitesOfService: (s) => idsOf([...arr(s.bitwardenSites), ...sites.filter((x) => x.serviceId === s.id).map((x) => x.site)]),
    consumersOfCred: (c) => idsOf([...arr(c.consumerIds), ...consumers.filter((k) => arr(k.credentialIds).includes(c.id)).map((k) => k.id)]),
    credsOfConsumer: (k) => idsOf([...arr(k.credentialIds), ...credentials.filter((c) => arr(c.consumerIds).includes(k.id)).map((c) => c.id)]),
    cronsOfConsumer: (k) => idsOf([...arr(k.cronIds), ...crons.filter((c) => c.consumerId === k.id).map((c) => c.id)]),
    servicesOfConsumer: (k) => idsOf([...arr(k.serviceIds), ...connections.filter((c) => c.from === k.id).map((c) => c.to)]),
    connsOfConsumer: (k) => connections.filter((c) => c.from === k.id),
    worstStatus: (creds) => creds.reduce((w, c) => (w == null || rankOf(c.status) > rankOf(w) ? c.status ?? "unknown" : w), null),
  };
}

const Ctx = createContext(null);
const useCtx = () => useContext(Ctx);
const qs = (tab, item) => { const p = new URLSearchParams(); p.set("tab", tab); if (has(item)) p.set("item", String(item)); return `?${p}`; };

// ── links ─────────────────────────────────────────────────────
// Every id the file mentions goes through this: known -> link that switches tab and selects;
// finding -> opens it in the strip; unknown -> inert chip with the raw id (a dangling ref is
// information, not an error).
function RefLink({ id, kind, mono, children }) {
  const { ix, openFinding } = useCtx();
  if (!has(id)) return <span style={{ color: C.dim }}>—</span>;
  const r = ix.resolve(id, kind);
  const font = mono ? { fontFamily: MONO, fontSize: 12 } : null;
  if (!r) return <span title="not in this file" style={{ ...chipS("mute"), fontFamily: MONO }}>{String(id)}</span>;
  if (r.finding) return <button type="button" onClick={() => openFinding(String(id))} title={String(id)} style={{ ...bareBtn, ...linkS, ...font }}>{children ?? r.label}</button>;
  if (!r.tab || r.item == null) return <Link to={{ search: qs(r.tab || "bitwarden") }} title={String(id)} style={{ ...linkS, ...font }}>{children ?? r.label}</Link>;
  return <Link to={{ search: qs(r.tab, r.item) }} title={String(id)} style={{ ...linkS, ...font }}>{children ?? r.label}</Link>;
}

const rowS = { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", minWidth: 0 };

function CredLine({ id, extra }) {
  const { ix } = useCtx();
  const c = ix.maps.credential.get(String(id));
  return (
    <div style={rowS}>
      <RefLink id={id} kind="credential" mono>{c ? show(c.name) : undefined}</RefLink>
      {c && <StatusBadge status={c.status} detail={c.statusDetail} />}
      {c && has(c.store) && <Chip>{c.store}</Chip>}
      {extra}
    </div>
  );
}
function ConsumerLine({ id }) {
  const { ix } = useCtx();
  const k = ix.maps.consumer.get(String(id));
  return (
    <div style={rowS}>
      <RefLink id={id} kind="consumer" />
      {k && has(k.kind) && <Chip>{k.kind}</Chip>}
      {k && k.active === false && <Chip tone="warn">inactive</Chip>}
    </div>
  );
}
function ServiceLine({ id }) {
  const { ix } = useCtx();
  const s = ix.maps.service.get(String(id));
  return (
    <div style={rowS}>
      <RefLink id={id} kind="service" />
      {s && has(s.category) && <Chip>{s.category}</Chip>}
    </div>
  );
}
function CronLine({ id }) {
  const { ix } = useCtx();
  const c = ix.maps.cron.get(String(id));
  return (
    <div style={rowS}>
      <RefLink id={id} kind="cron" />
      {c && has(c.schedule) && <Chip style={{ fontFamily: MONO }}>{c.schedule}</Chip>}
      {c && c.enabled === false && <Chip tone="warn">disabled</Chip>}
    </div>
  );
}
function SiteLine({ id }) {
  const { ix } = useCtx();
  const s = ix.maps.site.get(String(id));
  return (
    <div style={rowS}>
      <RefLink id={id} kind="site" mono />
      {s && arr(s.usernames).map((u) => <Chip key={u}>{u}</Chip>)}
    </div>
  );
}
const Stack = ({ children, gap = 4 }) => <div style={{ display: "flex", flexDirection: "column", gap, minWidth: 0 }}>{children}</div>;
const Dash = () => <span style={{ color: C.dim }}>—</span>;
function Lines({ ids, Line }) {
  const Item = Line; // (this lint setup does not count <Line /> as a use of the param)
  return arr(ids).length ? <Stack>{arr(ids).map((id) => <Item key={String(id)} id={id} />)}</Stack> : <Dash />;
}

// ── detail-panel building blocks ──────────────────────────────
function DHead({ title, id, mono, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.bright, fontFamily: mono ? MONO : "inherit", wordBreak: "break-word" }}>{show(title)}</span>
        {children}
      </div>
      {has(id) && <div style={{ fontSize: 10, color: C.dim, fontFamily: MONO, marginTop: 3, wordBreak: "break-all" }}>{String(id)}</div>}
    </div>
  );
}
function DSec({ title, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: C.dim, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
function Fields({ rows }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "104px minmax(0,1fr)", gap: "6px 12px", fontSize: 12 }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <div style={{ color: C.dim }}>{label}</div>
          <div style={{ color: C.text, minWidth: 0, wordBreak: "break-word" }}>{value == null || value === "" ? <Dash /> : value}</div>
        </div>
      ))}
    </div>
  );
}
function When({ iso }) {
  const { now } = useCtx();
  if (!has(iso)) return <Dash />;
  const rel = fmtRel(iso, now);
  return <span>{fmtAbs(iso)}{rel && <span style={{ color: C.dim }}> · {rel}</span>}</span>;
}
function Raw({ obj }) {
  return (
    <details style={{ marginTop: 16 }}>
      <summary style={{ fontSize: 11, color: C.dim, cursor: "pointer" }}>raw record</summary>
      <pre style={{ fontSize: 10.5, fontFamily: MONO, color: C.text, background: "rgba(255,255,255,0.03)", padding: 8, borderRadius: 8, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: 6 }}>{JSON.stringify(obj, null, 2)}</pre>
    </details>
  );
}
function FindingCard({ f }) {
  return (
    <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", borderLeft: `3px solid ${(TONES[SEV_TONE[f.severity]] || TONES.mute).fg}`, marginBottom: 6 }}>
      <div style={{ ...rowS, marginBottom: 3 }}>
        <SevBadge sev={f.severity} />
        {has(f.category) && <Chip>{f.category}</Chip>}
        <span style={{ fontSize: 12, fontWeight: 600, color: C.bright }}>{show(f.title)}</span>
      </div>
      {has(f.detail) && <div style={{ fontSize: 12, color: C.text, marginBottom: 3 }}>{f.detail}</div>}
      {has(f.action) && <div style={{ fontSize: 12, color: C.dim }}>Do: {f.action}</div>}
      {arr(f.refs).length > 0 && <div style={{ ...rowS, marginTop: 5, fontSize: 11 }}><span style={{ color: C.dim }}>refs</span>{arr(f.refs).map((r) => <RefLink key={String(r)} id={r} />)}</div>}
    </div>
  );
}
function FindingsBlock({ list }) {
  if (!list.length) return null;
  return <DSec title={`Findings (${list.length})`}>{list.map((f, i) => <FindingCard key={f.id ?? i} f={f} />)}</DSec>;
}
function FindingChip({ id }) {
  const { ix, openFinding } = useCtx();
  const f = ix.maps.finding.get(String(id));
  if (!f) return <Chip style={{ fontFamily: MONO }}>{String(id)}</Chip>;
  return (
    <button type="button" onClick={() => openFinding(String(id))} title={f.title} style={{ ...bareBtn, ...chipS(SEV_TONE[f.severity]), whiteSpace: "normal", maxWidth: 260, lineHeight: 1.35 }}>{f.severity} · {f.title}</button>
  );
}

// ── list scaffolding ──────────────────────────────────────────
const inputS = (narrow) => ({
  flex: "1 1 150px", minWidth: 0, fontSize: narrow ? 16 : 13, padding: "7px 10px", borderRadius: 8,
  border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontFamily: "inherit",
});
const checkS = { fontSize: 12, color: C.dim, display: "flex", gap: 5, alignItems: "center", whiteSpace: "nowrap" };

function SearchBox({ value, onChange, placeholder, label }) {
  const { narrow } = useCtx();
  return <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label || placeholder} title={label || undefined} style={inputS(narrow)} />;
}
function Pick({ value, onChange, options, all }) {
  const { narrow } = useCtx();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={all} style={{ ...inputS(narrow), flex: "0 1 130px" }}>
      <option value="">{all}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function ListRow({ selected, onClick, children }) {
  return (
    <button
      type="button" onClick={onClick} data-sel={selected ? "1" : undefined}
      style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", padding: "9px 10px", border: "none", borderBottom: `1px solid ${C.border}`, borderLeft: `3px solid ${selected ? BRAND.focus : "transparent"}`, background: selected ? "rgba(214,194,85,0.10)" : "transparent" }}
    >
      {children}
    </button>
  );
}
const GroupHead = ({ children }) => (
  <div style={{ padding: "6px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, color: C.dim, background: "rgba(255,255,255,0.03)", borderBottom: `1px solid ${C.border}` }}>{children}</div>
);
const Empty = ({ children }) => <div style={{ padding: 14, fontSize: 12, color: C.dim }}>{children}</div>;

// The scrollable list card. Keeps the selected row in view inside ITS OWN scroller (never
// scrolls the page; the detail panel owns that).
function ListPane({ controls, footer, selectedKey, children }) {
  const { narrow } = useCtx();
  const body = useRef(null);
  useEffect(() => {
    const el = body.current?.querySelector('[data-sel="1"]');
    const box = body.current;
    if (!el || !box) return;
    if (el.offsetTop < box.scrollTop) box.scrollTop = Math.max(0, el.offsetTop - 8);
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight + 8;
  }, [selectedKey]);
  return (
    <div style={{ ...inn, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: 10, borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{controls}</div>
      <div ref={body} style={{ position: "relative", maxHeight: narrow ? "50vh" : "calc(100vh - 250px)", minHeight: 80, overflowY: "auto" }}>{children}</div>
      {footer != null && <div style={{ padding: "6px 10px", fontSize: 11, color: C.dim, borderTop: `1px solid ${C.border}` }}>{footer}</div>}
    </div>
  );
}

// List left, detail right; stacked under 900px. Selecting something scrolls the detail panel
// into view (on a phone it sits under the list), which is also what a finding link relies on.
function MasterDetail({ list, detail, selectedKey }) {
  const { narrow } = useCtx();
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !selectedKey) return;
    el.scrollTop = 0;
    el.scrollIntoView({ behavior: "smooth", block: narrow ? "start" : "nearest" });
  }, [selectedKey, narrow]);
  const stick = narrow ? {} : { position: "sticky", top: 12 };
  return (
    <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr)" : "minmax(0,5fr) minmax(0,6fr)", gap: 14, alignItems: "start" }}>
      <div style={{ minWidth: 0, ...stick }}>{list}</div>
      {(!narrow || selectedKey) && (
        <div ref={ref} style={{ ...inn, padding: 16, minWidth: 0, ...stick, maxHeight: narrow ? "none" : "calc(100vh - 28px)", overflowY: narrow ? "visible" : "auto" }}>{detail}</div>
      )}
    </div>
  );
}
const NoSelection = () => <div style={{ fontSize: 13, color: C.dim }}>Pick something on the left. Every name in a panel is a link.</div>;
const NotFound = ({ id }) => <div style={{ fontSize: 13, color: C.dim }}>Nothing with id <span style={{ fontFamily: MONO, color: C.text }}>{id}</span> in this file. It may have been removed since the link was made.</div>;

// "Show N more" paging that never hides the selected row.
function usePaged(items, selectedIndex) {
  const [limit, setLimit] = useState(PAGE);
  const eff = Math.max(limit, selectedIndex + 1);
  return { shown: items.slice(0, eff), more: Math.max(0, items.length - eff), all: () => setLimit(items.length) };
}
const MoreBtn = ({ paged }) => (paged.more > 0 ? <div style={{ padding: 10 }}><button type="button" style={btnS(false)} onClick={paged.all}>Show {paged.more} more</button></div> : null);

// ── Services ──────────────────────────────────────────────────
function ServicesTab({ item }) {
  const { ix, go } = useCtx();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const cats = useMemo(() => uniq(ix.services.map((s) => s.category).filter(has)).sort(cmpStr), [ix]);
  const rows = useMemo(() => ix.services
    .filter((s) => (!cat || s.category === cat) && match(q, s.id, s.name, s.category, s.accounts, s.bitwardenSites, s.notes))
    .map((s) => { const cids = ix.credsOfService(s); return { s, n: cids.length, worst: ix.worstStatus(cids.map((id) => ix.maps.credential.get(id)).filter(Boolean)) }; })
    .sort((a, b) => rankOf(b.worst) - rankOf(a.worst) || cmpStr(a.s.name, b.s.name)), [ix, q, cat]);
  const sel = item ? ix.maps.service.get(item) : null;
  const paged = usePaged(rows, rows.findIndex((r) => String(r.s.id) === item));
  return (
    <MasterDetail
      selectedKey={item}
      list={(
        <ListPane
          selectedKey={item} footer={`${rows.length} of ${ix.services.length} services, worst credential status first`}
          controls={<><SearchBox value={q} onChange={setQ} placeholder="Search services, accounts…" /><Pick value={cat} onChange={setCat} options={cats} all="All categories" /></>}
        >
          {rows.length === 0 && <Empty>No services match.</Empty>}
          {paged.shown.map(({ s, n, worst }) => (
            <ListRow key={String(s.id)} selected={item === String(s.id)} onClick={() => go("services", s.id)}>
              <span style={{ ...rowS, flexWrap: "nowrap" }}>
                <span style={{ ...ellipsis, fontSize: 13, fontWeight: 600, color: C.bright, flex: "1 1 auto", minWidth: 0 }}>{show(s.name)}</span>
                {has(s.category) && <Chip>{s.category}</Chip>}
                <span style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>{n} cred{n === 1 ? "" : "s"}</span>
                {worst ? <StatusBadge status={worst} /> : <Chip>—</Chip>}
              </span>
            </ListRow>
          ))}
          <MoreBtn paged={paged} />
        </ListPane>
      )}
      detail={!item ? <NoSelection /> : sel ? <ServiceDetail s={sel} /> : <NotFound id={item} />}
    />
  );
}

function ServiceDetail({ s }) {
  const { ix } = useCtx();
  const conns = ix.connsOfService(s);
  const groups = new Map();
  for (const cn of conns) { const v = has(cn.via) ? String(cn.via) : "—"; if (!groups.has(v)) groups.set(v, []); groups.get(v).push(cn); }
  const vias = [...groups.keys()].sort((a, b) => { const x = VIA_ORDER.indexOf(a), y = VIA_ORDER.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || cmpStr(a, b); });
  const creds = ix.credsOfService(s);
  return (
    <>
      <DHead title={s.name} id={s.id}>{has(s.category) && <Chip>{s.category}</Chip>}</DHead>
      {has(s.notes) && <div style={{ ...noteS, marginBottom: 8 }}>{s.notes}</div>}
      <DSec title="Accounts">
        {arr(s.accounts).length ? <div style={rowS}>{arr(s.accounts).map((a) => <Chip key={a} tone="info">{show(a)}</Chip>)}</div> : <Dash />}
      </DSec>
      <DSec title={`Connections (${conns.length})`}>
        {conns.length === 0 && <Dash />}
        {vias.map((v) => (
          <div key={v} style={{ marginBottom: 10 }}>
            <div style={{ ...rowS, marginBottom: 4 }}><Chip tone="info">{VIA_LABEL[v] || v}</Chip><span style={{ fontSize: 11, color: C.dim }}>{groups.get(v).length}</span></div>
            {groups.get(v).map((cn, i) => (
              <div key={cn.id ?? i} style={{ padding: "5px 0 5px 10px", borderLeft: `2px solid ${C.border}`, marginBottom: 6 }}>
                <div style={rowS}>
                  <ConsumerLine id={cn.from} />
                  {has(cn.detail) && <span style={{ fontSize: 11, color: C.dim }}>{cn.detail}</span>}
                </div>
                <div style={{ marginTop: 4 }}>
                  {arr(cn.credentialIds).length ? <Stack gap={3}>{arr(cn.credentialIds).map((id) => <CredLine key={String(id)} id={id} />)}</Stack> : <span style={{ fontSize: 11, color: C.dim }}>no stored credential (session login or none found)</span>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </DSec>
      <DSec title={`All credentials for this service (${creds.length})`}><Lines ids={creds} Line={CredLine} /></DSec>
      <DSec title="Bitwarden logins"><Lines ids={ix.sitesOfService(s)} Line={SiteLine} /></DSec>
      <FindingsBlock list={ix.findingsOf(s)} />
      <Raw obj={s} />
    </>
  );
}

// ── Credentials ───────────────────────────────────────────────
const COLS = "minmax(0,2.4fr) 86px minmax(0,1.3fr) 76px 50px 84px";
const optionsOf = (list, key) => uniq(list.map((x) => x[key]).filter(has).map(String)).sort(cmpStr);
const nullsLast = (get, dir) => (a, b) => { const x = get(a), y = get(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x - y) * dir; };

function CredentialsTab({ item }) {
  const { ix, go, narrow, now } = useCtx();
  const [q, setQ] = useState("");
  const [store, setStore] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [dupOnly, setDupOnly] = useState(false);
  const [sort, setSort] = useState({ key: "status", dir: -1 });
  const stores = useMemo(() => optionsOf(ix.credentials, "store"), [ix]);
  const statuses = useMemo(() => optionsOf(ix.credentials, "status"), [ix]);
  const kinds = useMemo(() => optionsOf(ix.credentials, "kind"), [ix]);
  const rows = useMemo(() => {
    const svc = (c) => (has(c.serviceId) ? ix.nameOf("service", c.serviceId) : "");
    const cmps = {
      name: (a, b) => cmpStr(a.name, b.name) * sort.dir,
      store: (a, b) => cmpStr(a.store, b.store) * sort.dir,
      service: (a, b) => cmpStr(svc(a), svc(b)) * sort.dir,
      status: (a, b) => (rankOf(a.status) - rankOf(b.status)) * sort.dir,
      age: nullsLast((c) => (typeof c.ageDays === "number" ? c.ageDays : null), sort.dir),
      expires: nullsLast((c) => toMs(c.expires), sort.dir),
    };
    return ix.credentials
      .filter((c) => (!store || c.store === store) && (!status || c.status === status) && (!kind || c.kind === kind) && (!dupOnly || has(c.dupGroup))
        && match(q, c.id, c.name, c.store, c.kind, c.account, c.location, c.fingerprint, c.dupGroup, svc(c)))
      .sort((a, b) => cmps[sort.key](a, b) || cmpStr(a.name, b.name));
  }, [ix, q, store, status, kind, dupOnly, sort]);
  const sel = item ? ix.maps.credential.get(item) : null;
  const paged = usePaged(rows, rows.findIndex((c) => String(c.id) === item));
  const head = (key, label, defDir = 1) => (
    <button type="button" onClick={() => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: defDir }))} style={{ ...bareBtn, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, color: sort.key === key ? BRAND.focus : C.dim }}>
      {label}{sort.key === key ? (sort.dir > 0 ? " ▲" : " ▼") : ""}
    </button>
  );
  const age = (c) => (typeof c.ageDays === "number" ? `${c.ageDays}d` : "—");
  const exp = (c) => { const t = toMs(c.expires); return t == null ? "—" : <span style={{ color: t < now ? "#FCA5A5" : C.text }}>{String(c.expires).slice(0, 10)}</span>; };
  return (
    <MasterDetail
      selectedKey={item}
      list={(
        <ListPane
          selectedKey={item} footer={`${rows.length} of ${ix.credentials.length} credentials`}
          controls={(
            <>
              <SearchBox value={q} onChange={setQ} placeholder="Search…" label="Search name, account, location, fingerprint" />
              <Pick value={store} onChange={setStore} options={stores} all="Any store" />
              <Pick value={status} onChange={setStatus} options={statuses} all="Any status" />
              <Pick value={kind} onChange={setKind} options={kinds} all="Any kind" />
              <label style={checkS}><input type="checkbox" checked={dupOnly} onChange={(e) => setDupOnly(e.target.checked)} /> duplicates only</label>
            </>
          )}
        >
          {!narrow && rows.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "6px 10px 6px 13px", borderBottom: `1px solid ${C.border}`, background: "rgba(255,255,255,0.03)" }}>
              {head("name", "Name")}{head("store", "Store")}{head("service", "Service")}{head("status", "Status", -1)}{head("age", "Age", -1)}{head("expires", "Expires")}
            </div>
          )}
          {rows.length === 0 && <Empty>No credentials match.</Empty>}
          {paged.shown.map((c) => (
            <ListRow key={String(c.id)} selected={item === String(c.id)} onClick={() => go("credentials", c.id)}>
              {narrow ? (
                <>
                  <span style={{ ...rowS, flexWrap: "nowrap" }}>
                    <span style={{ ...ellipsis, fontFamily: MONO, fontSize: 12, color: C.bright, flex: "1 1 auto", minWidth: 0 }}>{show(c.name)}</span>
                    {has(c.dupGroup) && <Chip tone="warn">{String(c.dupGroup)}</Chip>}
                    <StatusBadge status={c.status} />
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: C.dim, marginTop: 2, ...ellipsis }}>
                    {show(c.store)} · {has(c.serviceId) ? ix.nameOf("service", c.serviceId) : "no service"} · {age(c)} old · expires {has(c.expires) ? String(c.expires).slice(0, 10) : "—"}
                  </span>
                </>
              ) : (
                <span style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, alignItems: "center" }}>
                  <span style={{ ...rowS, flexWrap: "nowrap" }}>
                    <span style={{ ...ellipsis, fontFamily: MONO, fontSize: 12, color: C.bright, minWidth: 0 }}>{show(c.name)}</span>
                    {has(c.dupGroup) && <Chip tone="warn">{String(c.dupGroup)}</Chip>}
                  </span>
                  <span style={{ ...ellipsis, fontSize: 11, color: C.dim }}>{show(c.store)}</span>
                  <span style={{ ...ellipsis, fontSize: 12, color: C.text }}>{has(c.serviceId) ? ix.nameOf("service", c.serviceId) : "—"}</span>
                  <span><StatusBadge status={c.status} /></span>
                  <span style={{ fontSize: 11, color: C.dim, fontFamily: MONO }}>{age(c)}</span>
                  <span style={{ fontSize: 11, fontFamily: MONO }}>{exp(c)}</span>
                </span>
              )}
            </ListRow>
          ))}
          <MoreBtn paged={paged} />
        </ListPane>
      )}
      detail={!item ? <NoSelection /> : sel ? <CredentialDetail c={sel} /> : <NotFound id={item} />}
    />
  );
}

function CredentialDetail({ c }) {
  const { ix } = useCtx();
  const peers = has(c.dupGroup) ? (ix.dupGroups.get(String(c.dupGroup)) || []).filter((x) => x !== c) : [];
  const scopes = c.scopes == null ? <span style={{ color: C.dim }}>unknown</span> : arr(c.scopes).length ? <div style={rowS}>{arr(c.scopes).map((s) => <Chip key={s}>{show(s)}</Chip>)}</div> : <span style={{ color: C.dim }}>none</span>;
  const p = c.probe && typeof c.probe === "object" ? c.probe : null;
  return (
    <>
      <DHead title={c.name} id={c.id} mono>
        <StatusBadge status={c.status} />
        {has(c.dupGroup) && <Chip tone="warn">dup {String(c.dupGroup)}</Chip>}
      </DHead>
      {has(c.statusDetail) && <div style={{ fontSize: 12, color: C.text, marginBottom: 10 }}>{c.statusDetail}</div>}
      <Fields rows={[
        ["Store", has(c.store) ? <Chip>{c.store}</Chip> : null],
        ["Location", has(c.location) ? <span style={{ fontFamily: MONO, fontSize: 11 }}>{c.location}</span> : null],
        ["Kind", has(c.kind) ? <Chip>{c.kind}</Chip> : null],
        ["Service", has(c.serviceId) ? <ServiceLine id={c.serviceId} /> : null],
        ["Account", has(c.account) ? show(c.account) : null],
        ["Scopes", scopes],
        ["Created", has(c.created) ? <When iso={c.created} /> : null],
        ["Updated", has(c.updated) ? <When iso={c.updated} /> : null],
        ["Expires", has(c.expires) ? <When iso={c.expires} /> : null],
        ["Age", typeof c.ageDays === "number" ? `${c.ageDays} days` : null],
        ["Fingerprint", has(c.fingerprint) ? <span style={{ fontFamily: MONO }}>{c.fingerprint}</span> : <span style={{ color: C.dim }}>none (value unreadable or empty)</span>],
      ]}
      />
      <DSec title="Same value also lives in">
        {!has(c.dupGroup) ? <span style={{ fontSize: 12, color: C.dim }}>Nowhere else on this box.</span>
          : peers.length === 0 ? <span style={{ fontSize: 12, color: C.dim }}>Group {String(c.dupGroup)} lists no other credential in this file.</span>
            : <Stack gap={6}>{peers.map((x) => <CredLine key={String(x.id)} id={x.id} extra={<span style={{ fontSize: 11, color: C.dim }}>{show(x.location)}</span>} />)}</Stack>}
      </DSec>
      <DSec title="Consumers"><Lines ids={ix.consumersOfCred(c)} Line={ConsumerLine} /></DSec>
      <DSec title="Live check">
        {p ? (
          <div style={rowS}>
            <Chip tone={p.ok ? "good" : "bad"}>{p.ok ? "probe ok" : "probe failed"}</Chip>
            {has(p.detail) && <span style={{ fontFamily: MONO, fontSize: 11 }}>{p.detail}</span>}
            {has(p.at) && <span style={{ fontSize: 11, color: C.dim }}><When iso={p.at} /></span>}
          </div>
        ) : <span style={{ fontSize: 12, color: C.dim }}>Not probed.</span>}
      </DSec>
      <FindingsBlock list={ix.findingsOf(c)} />
      <Raw obj={c} />
    </>
  );
}

// ── Crons ─────────────────────────────────────────────────────
function groupBy(list, get, order) {
  const m = new Map();
  for (const x of list) { const k = has(get(x)) ? String(get(x)) : "—"; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return [...m.entries()].sort(([a], [b]) => { const x = order.indexOf(a), y = order.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || cmpStr(a, b); });
}

function CronsTab({ item }) {
  const { ix, go, now } = useCtx();
  const [q, setQ] = useState("");
  const [en, setEn] = useState("");
  const groups = useMemo(() => groupBy(
    ix.crons.filter((c) => (!en || (en === "enabled" ? c.enabled !== false : c.enabled === false)) && match(q, c.id, c.name, c.schedule, c.runs, c.location, c.where, c.tz, c.lastStatus)),
    (c) => c.where, WHERE_ORDER,
  ), [ix, q, en]);
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  const sel = item ? ix.maps.cron.get(item) : null;
  return (
    <MasterDetail
      selectedKey={item}
      list={(
        <ListPane
          selectedKey={item} footer={`${total} of ${ix.crons.length} scheduled things`}
          controls={<><SearchBox value={q} onChange={setQ} placeholder="Search name, script, schedule…" /><Pick value={en} onChange={setEn} options={["enabled", "disabled"]} all="Enabled or not" /></>}
        >
          {total === 0 && <Empty>No crons match.</Empty>}
          {groups.map(([where, list]) => (
            <div key={where}>
              <GroupHead>{where} · {list.length}</GroupHead>
              {list.map((c, i) => (
                <ListRow key={String(c.id ?? i)} selected={item === String(c.id)} onClick={() => go("crons", c.id)}>
                  <span style={{ ...rowS, flexWrap: "nowrap" }}>
                    <span title={c.enabled === false ? "disabled" : "enabled"} style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: c.enabled === false ? C.dim : STATUS.good }} />
                    <span style={{ ...ellipsis, fontSize: 13, fontWeight: 600, color: C.bright, flex: "1 1 auto", minWidth: 0 }}>{show(c.name)}</span>
                    <Chip style={{ fontFamily: MONO }}>{show(c.schedule)}</Chip>
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: C.dim, marginTop: 2, ...ellipsis }}>
                    {show(c.tz)} · {show(c.runs)} · {show(c.location)}
                  </span>
                  <span style={{ ...rowS, fontSize: 11, color: C.dim, marginTop: 2 }}>
                    {has(c.lastRun) ? <>last run {fmtRel(c.lastRun, now) || fmtAbs(c.lastRun)}{has(c.lastStatus) && <Chip tone={/^(ok|success|passed)$/i.test(String(c.lastStatus)) ? "good" : "bad"}>{String(c.lastStatus)}</Chip>}</> : "no run recorded"}
                  </span>
                </ListRow>
              ))}
            </div>
          ))}
        </ListPane>
      )}
      detail={!item ? <NoSelection /> : sel ? <CronDetail c={sel} /> : <NotFound id={item} />}
    />
  );
}

function CronDetail({ c }) {
  const { ix } = useCtx();
  return (
    <>
      <DHead title={c.name} id={c.id}>
        <Chip tone={c.enabled === false ? "warn" : "good"}>{c.enabled === false ? "disabled" : "enabled"}</Chip>
      </DHead>
      <Fields rows={[
        ["Where", has(c.where) ? <Chip>{c.where}</Chip> : null],
        ["Schedule", has(c.schedule) ? <span style={{ fontFamily: MONO }}>{c.schedule}</span> : null],
        ["Timezone", has(c.tz) ? String(c.tz) : null],
        ["Runs", has(c.runs) ? <span style={{ fontFamily: MONO, fontSize: 11 }}>{c.runs}</span> : null],
        ["Location", has(c.location) ? <span style={{ fontFamily: MONO, fontSize: 11 }}>{c.location}</span> : null],
        ["Last run", has(c.lastRun) ? <When iso={c.lastRun} /> : null],
        ["Last status", has(c.lastStatus) ? <Chip tone={/^(ok|success|passed)$/i.test(String(c.lastStatus)) ? "good" : "bad"}>{String(c.lastStatus)}</Chip> : null],
      ]}
      />
      <DSec title="Consumer">{has(c.consumerId) ? <ConsumerLine id={c.consumerId} /> : <Dash />}</DSec>
      <DSec title="Credentials it uses"><Lines ids={arr(c.credentialIds)} Line={CredLine} /></DSec>
      <DSec title="Services it touches"><Lines ids={arr(c.serviceIds)} Line={ServiceLine} /></DSec>
      <FindingsBlock list={ix.findingsOf(c)} />
      <Raw obj={c} />
    </>
  );
}

// ── Consumers ─────────────────────────────────────────────────
function ConsumersTab({ item }) {
  const { ix, go } = useCtx();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [act, setAct] = useState("");
  const kinds = useMemo(() => optionsOf(ix.consumers, "kind"), [ix]);
  const groups = useMemo(() => groupBy(
    ix.consumers.filter((k) => (!kind || k.kind === kind) && (!act || (act === "active" ? k.active !== false : k.active === false)) && match(q, k.id, k.name, k.kind, k.detail, k.location)),
    (k) => k.kind, KIND_ORDER,
  ), [ix, q, kind, act]);
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  const sel = item ? ix.maps.consumer.get(item) : null;
  return (
    <MasterDetail
      selectedKey={item}
      list={(
        <ListPane
          selectedKey={item} footer={`${total} of ${ix.consumers.length} consumers`}
          controls={<><SearchBox value={q} onChange={setQ} placeholder="Search consumers…" /><Pick value={kind} onChange={setKind} options={kinds} all="Any kind" /><Pick value={act} onChange={setAct} options={["active", "inactive"]} all="Active or not" /></>}
        >
          {total === 0 && <Empty>No consumers match.</Empty>}
          {groups.map(([k, list]) => (
            <div key={k}>
              <GroupHead>{k} · {list.length}</GroupHead>
              {list.map((x, i) => {
                const nc = ix.credsOfConsumer(x).length;
                return (
                  <ListRow key={String(x.id ?? i)} selected={item === String(x.id)} onClick={() => go("consumers", x.id)}>
                    <span style={{ ...rowS, flexWrap: "nowrap" }}>
                      <span title={x.active === false ? "inactive" : "active"} style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: x.active === false ? C.dim : STATUS.good }} />
                      <span style={{ ...ellipsis, fontSize: 13, fontWeight: 600, color: C.bright, flex: "1 1 auto", minWidth: 0 }}>{show(x.name)}</span>
                      <span style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>{nc} cred{nc === 1 ? "" : "s"}</span>
                    </span>
                    {has(x.detail) && <span style={{ display: "block", fontSize: 11, color: C.dim, marginTop: 2, ...ellipsis }}>{x.detail}</span>}
                  </ListRow>
                );
              })}
            </div>
          ))}
        </ListPane>
      )}
      detail={!item ? <NoSelection /> : sel ? <ConsumerDetail k={sel} /> : <NotFound id={item} />}
    />
  );
}

function ConsumerDetail({ k }) {
  const { ix } = useCtx();
  const conns = ix.connsOfConsumer(k);
  return (
    <>
      <DHead title={k.name} id={k.id}>
        {has(k.kind) && <Chip>{k.kind}</Chip>}
        <Chip tone={k.active === false ? "warn" : "good"}>{k.active === false ? "inactive" : "active"}</Chip>
      </DHead>
      {has(k.detail) && <div style={{ fontSize: 12, color: C.text, marginBottom: 8 }}>{k.detail}</div>}
      <Fields rows={[["Location", has(k.location) ? <span style={{ fontFamily: MONO, fontSize: 11 }}>{k.location}</span> : null]]} />
      <DSec title="Credentials it holds"><Lines ids={ix.credsOfConsumer(k)} Line={CredLine} /></DSec>
      <DSec title="Services it reaches"><Lines ids={ix.servicesOfConsumer(k)} Line={ServiceLine} /></DSec>
      {conns.length > 0 && (
        <DSec title="How it connects">
          <Stack gap={4}>
            {conns.map((cn, i) => (
              <div key={cn.id ?? i} style={rowS}>
                <Chip tone="info">{VIA_LABEL[cn.via] || show(cn.via)}</Chip>
                <RefLink id={cn.to} kind="service" />
                {has(cn.detail) && <span style={{ fontSize: 11, color: C.dim }}>{cn.detail}</span>}
              </div>
            ))}
          </Stack>
        </DSec>
      )}
      <DSec title="Crons"><Lines ids={ix.cronsOfConsumer(k)} Line={CronLine} /></DSec>
      <FindingsBlock list={ix.findingsOf(k)} />
      <Raw obj={k} />
    </>
  );
}

// ── Bitwarden ─────────────────────────────────────────────────
// Worth a look: more than one username on a site, or exact duplicate items.
const flagged = (s) => arr(s.usernames).length > 1 || (typeof s.dupCopies === "number" && s.dupCopies > 0);

function BitwardenTab({ item }) {
  const { ix, go, now, narrow } = useCtx();
  const [q, setQ] = useState("");
  const [flagOnly, setFlagOnly] = useState(false);
  const bw = ix.bw;
  const rows = useMemo(() => [...ix.sites]
    .filter((s) => (!flagOnly || flagged(s)) && match(q, s.site, s.usernames, s.serviceId, has(s.serviceId) ? ix.nameOf("service", s.serviceId) : ""))
    .sort((a, b) => (Number(b.copies) || 0) - (Number(a.copies) || 0) || cmpStr(a.site, b.site)), [ix, q, flagOnly]);
  const sel = item ? ix.maps.site.get(item) : null;
  const paged = usePaged(rows, rows.findIndex((s) => String(s.site) === item));

  if (!bw) return <div style={noteS}>No Bitwarden block in this file. The collector found no vault review to read.</div>;
  const asOfMs = toMs(bw.asOf);
  const ageDays = asOfMs == null ? null : Math.floor((now - asOfMs) / 86400000);
  const stale = ageDays == null || ageDays > STALE_REVIEW_DAYS;
  const totals = bw.totals && typeof bw.totals === "object" ? bw.totals : null;
  return (
    <>
      <div style={{ ...noteS, border: `1px solid ${stale ? "rgba(217,169,59,0.4)" : C.border}`, marginBottom: 12 }}>
        <div>Source: <b style={{ color: C.bright }}>{show(bw.source)}</b> · as of <b style={{ color: C.bright }}>{show(bw.asOf)}</b>{ageDays != null && ` (${ageDays} days ago)`}</div>
        {stale && <div style={{ color: STATUS.warn, marginTop: 4 }}>Stale: {ageDays == null ? "this review has no readable as-of date" : `this review is ${ageDays} days old (limit ${STALE_REVIEW_DAYS})`}. The vault may have changed since.</div>}
        <div style={{ color: C.dim, marginTop: 4 }}>This is vault metadata only: site, username, owner, collection. Never a password.</div>
        {totals && <div style={{ ...rowS, marginTop: 6 }}>{Object.entries(totals).map(([k, v]) => <Chip key={k}>{k} {show(v)}</Chip>)}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr)" : "minmax(0,5fr) minmax(0,7fr)", gap: 14, marginBottom: 14 }}>
        <div style={{ ...inn, padding: 12, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.bright, marginBottom: 6 }}>Identities ({ix.identities.length})</div>
          {ix.identities.length === 0 ? <Dash /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={thS}>Email</th><th style={thS}>Role</th><th style={thS}>State</th></tr></thead>
                <tbody>{ix.identities.map((x, i) => <tr key={i}><td style={{ ...tdS, fontFamily: MONO, fontSize: 11 }}>{show(x.email)}</td><td style={tdS}>{show(x.role)}</td><td style={tdS}>{show(x.state)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
        <div style={{ ...inn, padding: 12, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.bright, marginBottom: 6 }}>Machine accounts ({ix.machines.length})</div>
          {ix.machines.length === 0 ? <Dash /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={thS}>Name</th><th style={thS}>Projects</th><th style={thS}>Token</th><th style={thS}>Used by</th><th style={thS}>Findings</th></tr></thead>
                <tbody>
                  {ix.machines.map((m, i) => (
                    <tr key={i}>
                      <td style={{ ...tdS, fontWeight: 600, color: C.bright, whiteSpace: "nowrap" }}>{show(m.name)}</td>
                      <td style={tdS}><div style={rowS}>{arr(m.projects).length ? arr(m.projects).map((p) => <Chip key={p}>{show(p)}</Chip>) : <Dash />}</div></td>
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>{show(m.token)}</td>
                      <td style={{ ...tdS, fontFamily: MONO, fontSize: 11, wordBreak: "break-all" }}>{show(m.usedBy)}</td>
                      <td style={tdS}>{arr(m.findingIds).length ? <Stack gap={3}>{arr(m.findingIds).map((id) => <FindingChip key={String(id)} id={id} />)}</Stack> : <Dash />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <MasterDetail
        selectedKey={item}
        list={(
          <ListPane
            selectedKey={item} footer={`${rows.length} of ${ix.sites.length} sites, most copies first`}
            controls={<><SearchBox value={q} onChange={setQ} placeholder="Search site, username, service…" /><label style={checkS}><input type="checkbox" checked={flagOnly} onChange={(e) => setFlagOnly(e.target.checked)} /> flagged only</label></>}
          >
            {rows.length === 0 && <Empty>No sites match.</Empty>}
            {paged.shown.map((s) => {
              const users = arr(s.usernames);
              return (
                <ListRow key={String(s.site)} selected={item === String(s.site)} onClick={() => go("bitwarden", s.site)}>
                  <span style={{ ...rowS, flexWrap: "nowrap" }}>
                    <span style={{ ...ellipsis, fontFamily: MONO, fontSize: 12, color: C.bright, flex: "1 1 auto", minWidth: 0 }}>{show(s.site)}</span>
                    {users.length > 1 && <Chip tone="warn">{users.length} usernames</Chip>}
                    {typeof s.dupCopies === "number" && s.dupCopies > 0 && <Chip tone="warn">dup ×{s.dupCopies}</Chip>}
                    <Chip>{show(s.copies)} cop{s.copies === 1 ? "y" : "ies"}</Chip>
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: C.dim, marginTop: 2, ...ellipsis }}>
                    {users.length ? users.join(", ") : "—"}{has(s.serviceId) ? ` · ${ix.nameOf("service", s.serviceId)}` : ""}
                  </span>
                </ListRow>
              );
            })}
            <MoreBtn paged={paged} />
          </ListPane>
        )}
        detail={!item ? <NoSelection /> : sel ? <SiteDetail s={sel} /> : <NotFound id={item} />}
      />
    </>
  );
}

function SiteDetail({ s }) {
  const { ix } = useCtx();
  const users = arr(s.usernames);
  const items = objs(s.items);
  return (
    <>
      <DHead title={s.site} mono>
        {typeof s.dupCopies === "number" && s.dupCopies > 0 && <Chip tone="warn">dup ×{s.dupCopies}</Chip>}
        {users.length > 1 && <Chip tone="warn">{users.length} usernames</Chip>}
      </DHead>
      <Fields rows={[
        ["Service", has(s.serviceId) ? <ServiceLine id={s.serviceId} /> : null],
        ["Copies", has(s.copies) ? String(s.copies) : null],
        ["Dup copies", has(s.dupCopies) ? String(s.dupCopies) : null],
        ["Usernames", users.length ? <div style={rowS}>{users.map((u) => <Chip key={u} tone={users.length > 1 ? "warn" : "mute"}>{show(u)}</Chip>)}</div> : null],
      ]}
      />
      <DSec title={`Items (${items.length})`}>
        {items.length === 0 ? <Dash /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={thS}>Name</th><th style={thS}>Username</th><th style={thS}>Owner</th><th style={thS}>Collection</th><th style={thS}>Revised</th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td style={tdS}>{show(it.name)}</td>
                    <td style={{ ...tdS, fontFamily: MONO, fontSize: 11 }}>{show(it.username)}</td>
                    <td style={tdS}>{show(it.owner)}</td>
                    <td style={tdS}>{show(it.collection)}</td>
                    <td style={{ ...tdS, whiteSpace: "nowrap" }}>{has(it.revised) ? fmtAbs(it.revised) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DSec>
      <FindingsBlock list={ix.findingsOf(s)} />
      <Raw obj={s} />
    </>
  );
}

// ── Findings strip ────────────────────────────────────────────
const pillS = (tone, active) => {
  const t = TONES[tone] || TONES.mute;
  return { fontSize: 11, fontWeight: 600, padding: "4px 11px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", color: active ? "#FFF" : t.fg, background: active ? t.fg : t.bg, border: `1px solid ${t.bd}`, opacity: active ? 1 : 0.95 };
};

function FindingsStrip({ stripRef, open, setOpen, sev, setSev, expanded, toggle }) {
  const { ix, narrow, go } = useCtx();
  const counts = { all: ix.findings.length };
  for (const s of SEV_ORDER) counts[s] = ix.findings.filter((f) => f.severity === s).length;
  counts.other = counts.all - SEV_ORDER.reduce((n, s) => n + counts[s], 0);
  const list = useMemo(() => ix.findings
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !sev || (sev === "other" ? !SEV_ORDER.includes(f.severity) : f.severity === sev))
    .sort((a, b) => sevRank(a.f.severity) - sevRank(b.f.severity) || a.i - b.i)
    .map(({ f }) => f), [ix, sev]);
  // click = jump to the first ref that exists in this file
  const jump = (f) => { const r = arr(f.refs).map((x) => ix.resolve(x)).find((x) => x && x.tab); if (r) go(r.tab, r.item); else toggle(String(f.id)); };
  return (
    <div ref={stripRef} style={{ ...crd, padding: narrow ? 10 : 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{ ...bareBtn, display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 700, color: C.bright }}>
          <span style={{ fontSize: 11, color: C.dim }}>{open ? "▼" : "▶"}</span>Findings
        </button>
        <button type="button" style={pillS("mute", !sev)} onClick={() => setSev(null)}>All {counts.all}</button>
        {SEV_ORDER.map((s) => <button key={s} type="button" style={pillS(SEV_TONE[s], sev === s)} onClick={() => setSev(sev === s ? null : s)}>{s} {counts[s]}</button>)}
        {counts.other > 0 && <button type="button" style={pillS("mute", sev === "other")} onClick={() => setSev(sev === "other" ? null : "other")}>other {counts.other}</button>}
      </div>
      {open && (
        <div style={{ marginTop: 12, maxHeight: narrow ? "60vh" : 360, overflowY: "auto" }}>
          {list.length === 0 && <div style={{ fontSize: 13, color: C.dim }}>{ix.findings.length === 0 ? "No findings in this file." : "No findings at this severity."}</div>}
          {list.map((f, i) => {
            const id = String(f.id ?? `i${i}`);
            const isOpen = expanded.has(id);
            return (
              <div key={id} data-finding={id} style={{ padding: "8px 10px", marginBottom: 6, borderRadius: 8, background: isOpen ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.03)", borderLeft: `3px solid ${(TONES[SEV_TONE[f.severity]] || TONES.mute).fg}` }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <button type="button" onClick={() => jump(f)} title="Open the first thing this is about" style={{ ...bareBtn, flex: 1, minWidth: 0 }}>
                    <span style={{ ...rowS, marginBottom: 2 }}>
                      <SevBadge sev={f.severity} />
                      {has(f.category) && <Chip>{f.category}</Chip>}
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.bright }}>{show(f.title)}</span>
                    </span>
                    {has(f.action) && <span style={{ display: "block", fontSize: 12, color: C.dim }}>{f.action}</span>}
                  </button>
                  <button type="button" onClick={() => toggle(id)} aria-expanded={isOpen} style={{ ...bareBtn, fontSize: 11, color: BRAND.link, whiteSpace: "nowrap", paddingTop: 2 }}>{isOpen ? "less" : "details"}</button>
                </div>
                {isOpen && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                    {has(f.detail) && <div style={{ fontSize: 12, color: C.text, marginBottom: 6 }}>{f.detail}</div>}
                    <div style={{ ...rowS, fontSize: 11 }}>
                      <span style={{ color: C.dim }}>about</span>
                      {arr(f.refs).length ? arr(f.refs).map((r) => <RefLink key={String(r)} id={r} />) : <Dash />}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Header pieces ─────────────────────────────────────────────
function SourceList({ sources }) {
  const [open, setOpen] = useState(null);
  const failed = sources.filter((s) => s.ok === false).length;
  const isOpen = open ?? failed > 0;
  const tone = (s) => (s.ok === true ? "good" : s.ok === false ? "bad" : "mute");
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ ...rowS, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: C.dim }}>Sources</span>
        {sources.map((s, i) => (
          <Chip key={s.id ?? i} tone={tone(s)} title={show(s.error ?? s.detail)}>{s.ok === false ? "✕ " : s.ok === true ? "✓ " : ""}{show(s.label ?? s.id)}{has(s.count) ? ` · ${s.count}` : ""}</Chip>
        ))}
        {sources.length === 0 && <span style={{ fontSize: 11, color: C.dim }}>none listed</span>}
        {sources.length > 0 && <button type="button" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen} style={{ ...bareBtn, fontSize: 11, color: BRAND.link }}>{isOpen ? "hide details" : failed ? `details (${failed} failed)` : "details"}</button>}
      </div>
      {isOpen && (
        <div style={{ marginTop: 8, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr><th style={thS}>Source</th><th style={thS}>State</th><th style={thS}>Count</th><th style={thS}>Time</th><th style={thS}>Detail</th></tr></thead>
            <tbody>
              {sources.map((s, i) => (
                <tr key={s.id ?? i}>
                  <td style={{ ...tdS, fontWeight: 600, color: C.bright }}>{show(s.label ?? s.id)}</td>
                  <td style={tdS}><Chip tone={tone(s)}>{s.ok === true ? "ok" : s.ok === false ? "incomplete" : "—"}</Chip></td>
                  <td style={tdS}>{show(s.count)}</td>
                  <td style={{ ...tdS, whiteSpace: "nowrap" }}>{typeof s.ms === "number" ? `${s.ms} ms` : "—"}</td>
                  <td style={tdS}>{has(s.error) ? <span style={{ color: "#FCA5A5" }}>{s.error}</span> : show(s.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const logText = (lines) => (Array.isArray(lines) ? lines.join("\n") : has(lines) ? String(lines) : "");

function Controls({ probe, setProbe, onRefresh, status, note, clearNote }) {
  const { now } = useCtx();
  const running = !!status?.running;
  const log = logText(status?.logTail);
  const exit = status?.exitCode;
  const failedRun = !running && status?.finishedAt && exit != null && exit !== 0;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" style={{ ...btnS(true), padding: "7px 18px", fontSize: 12 }} disabled={running} onClick={onRefresh}>{running ? "Refreshing…" : "Refresh"}</button>
        <label style={checkS} title="Also run the read-only auth checks against each service (slower)"><input type="checkbox" checked={probe} disabled={running} onChange={(e) => setProbe(e.target.checked)} /> with live checks</label>
        {!running && status?.finishedAt && <span style={{ fontSize: 11, color: failedRun ? "#FCA5A5" : C.dim }}>last run finished {fmtRel(status.finishedAt, now) || fmtAbs(status.finishedAt)}{exit != null ? `, exit ${exit}` : ""}</span>}
      </div>
      {note && <div style={{ ...noteS, marginTop: 8 }}>{note}<button type="button" style={{ ...btnS(false), marginLeft: 10 }} onClick={clearNote}>Dismiss</button></div>}
      {running && (
        <div style={{ ...noteS, marginTop: 8 }} role="status">
          Collector running{status?.startedAt ? `, started ${fmtRel(status.startedAt, now) || fmtAbs(status.startedAt)}` : ""}. This page reloads when it finishes.
          {log && <pre style={{ fontFamily: MONO, fontSize: 10.5, color: C.dim, margin: "6px 0 0", maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{log}</pre>}
        </div>
      )}
      {failedRun && log && <pre style={{ ...noteS, fontFamily: MONO, fontSize: 10.5, color: "#FCA5A5", marginTop: 8, maxHeight: 160, overflow: "auto", wordBreak: "break-all" }}>{log}</pre>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function AccessView() {
  const [sp, setSp] = useSearchParams();
  const narrow = useNarrow(900);
  const now = useNow();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [status, setStatus] = useState(null);
  const [probe, setProbe] = useState(false);
  const [note, setNote] = useState(null);
  const [findOpen, setFindOpen] = useState(null); // null = auto (open when any high finding)
  const [sev, setSev] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const stripRef = useRef(null);
  const ix = useMemo(() => buildIndex(data), [data]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/access-map");
      if (r.status === 401) { setErr("session expired"); return; }
      const body = await r.json().catch(() => null);
      if (!r.ok || !body?.ok) throw new Error(body?.error || `HTTP ${r.status}`);
      setData(body.data);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/access-map/status");
      if (!r.ok) return null;
      const body = await r.json();
      return body && body.ok !== false ? body : null;
    } catch { return null; }
  }, []);

  useEffect(() => { load(); }, [load]);
  // A refresh may already be running (started from another tab or before a reload).
  useEffect(() => { fetchStatus().then((s) => { if (s) setStatus(s); }); }, [fetchStatus]);
  // While running: poll every 3 s; when it stops, pull the new data.
  const running = !!status?.running;
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(async () => {
      const s = await fetchStatus();
      if (!s) return;
      setStatus(s);
      if (!s.running) load();
    }, 3000);
    return () => clearInterval(t);
  }, [running, fetchStatus, load]);

  const refresh = async () => {
    setNote(null);
    try {
      const r = await fetch("/api/access-map/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ probe }) });
      const body = await r.json().catch(() => ({}));
      if (r.status === 202 || r.status === 409) {
        if (r.status === 409) setNote("A refresh was already running. Following it.");
        setStatus((s) => ({ ...(s || {}), running: true, startedAt: s?.startedAt ?? new Date().toISOString(), finishedAt: null, exitCode: null, logTail: s?.logTail ?? [] }));
        fetchStatus().then((s) => { if (s) setStatus(s); });
        return;
      }
      setNote(`Refresh failed: ${body.error || `HTTP ${r.status}`}`);
    } catch (e) { setNote(`Refresh failed: ${e.message}`); }
  };

  // URL <-> selection
  const tabParam = sp.get("tab");
  const itemParam = sp.get("item");
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam : (itemParam && ix.resolve(itemParam)?.tab) || "services";
  const item = itemParam || null;
  const go = useCallback((t, i) => { const p = new URLSearchParams(); p.set("tab", t); if (has(i)) p.set("item", String(i)); setSp(p); }, [setSp]);

  const openFinding = useCallback((id) => {
    setFindOpen(true);
    setSev(null);
    setExpanded((s) => new Set(s).add(id));
    requestAnimationFrame(() => {
      const el = stripRef.current?.querySelector(`[data-finding="${CSS.escape(id)}"]`) || stripRef.current;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);
  const toggleFinding = useCallback((id) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

  const ctx = useMemo(() => ({ ix, now, narrow, go, openFinding }), [ix, now, narrow, go, openFinding]);

  const sources = objs(data?.sources);
  const high = ix.findings.filter((f) => f.severity === "high").length;
  const count = (key, list) => (Array.isArray(data?.[key]) ? list.length : data?.summary?.[key]);
  const tiles = [
    { key: "services", label: "services", n: count("services", ix.services), tab: "services" },
    { key: "credentials", label: "credentials", n: count("credentials", ix.credentials), tab: "credentials" },
    { key: "consumers", label: "consumers", n: count("consumers", ix.consumers), tab: "consumers" },
    { key: "connections", label: "connections", n: count("connections", ix.connections), tab: null },
    { key: "crons", label: "crons", n: count("crons", ix.crons), tab: "crons" },
  ];
  const tabCount = { services: ix.services.length, credentials: ix.credentials.length, crons: ix.crons.length, consumers: ix.consumers.length, bitwarden: ix.sites.length };

  return (
    <Ctx.Provider value={ctx}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Section title="Access">
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>
            Every credential, service connection, cron and Bitwarden login on this server. Values never appear here, only fingerprints.{" "}
            <Link to="/systems" style={linkS}>← Systems</Link>
          </div>
          {data?.sample && <div style={{ ...noteS, border: "1px solid rgba(217,169,59,0.4)", color: STATUS.warn, marginBottom: 10 }}>Showing sample data: run the collector</div>}
          {data && (
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>
              Generated <b style={{ color: C.text }}>{fmtRel(data.generatedAt, now) || "at an unknown time"}</b>{has(data.generatedAt) && <> · {fmtAbs(data.generatedAt)}</>}
              {has(data.host) && <> · host {String(data.host)}</>} · {data.probed ? "live checks ran" : "live checks not run"}
            </div>
          )}
          {err && <div style={{ ...noteS, border: "1px solid rgba(220,38,38,0.4)", color: "#FCA5A5", marginBottom: 10 }}>{data ? `Could not reload: ${err}` : `Could not load the access map: ${err}`}</div>}
          {!data && !err && <div style={{ color: C.dim, fontSize: 13, marginBottom: 10 }}>Loading…</div>}
          {data && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {tiles.map((t) => {
                const body = <><span style={{ display: "block", fontSize: 20, fontWeight: 700, color: C.bright, fontFamily: MONO }}>{show(t.n)}</span><span style={{ fontSize: 11, color: C.dim }}>{t.label}</span></>;
                const s = { ...inn, padding: "8px 14px", minWidth: 92, textAlign: "left", font: "inherit" };
                return t.tab ? <button key={t.key} type="button" onClick={() => go(t.tab)} style={{ ...s, cursor: "pointer", color: "inherit" }}>{body}</button> : <div key={t.key} style={s}>{body}</div>;
              })}
            </div>
          )}
          <Controls probe={probe} setProbe={setProbe} onRefresh={refresh} status={status} note={note} clearNote={() => setNote(null)} />
          {data && <SourceList sources={sources} />}
        </Section>

        {data && (
          <>
            <FindingsStrip stripRef={stripRef} open={findOpen ?? high > 0} setOpen={setFindOpen} sev={sev} setSev={setSev} expanded={expanded} toggle={toggleFinding} />
            <div style={{ ...crd, padding: narrow ? 10 : 16 }}>
              <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                {TABS.map((t) => (
                  <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} style={{ ...btnS(tab === t.key), padding: "7px 14px", fontSize: 12 }} onClick={() => go(t.key)}>
                    {t.label} <span style={{ opacity: 0.7, fontFamily: MONO }}>{tabCount[t.key]}</span>
                  </button>
                ))}
              </div>
              {tab === "services" && <ServicesTab item={item} />}
              {tab === "credentials" && <CredentialsTab item={item} />}
              {tab === "crons" && <CronsTab item={item} />}
              {tab === "consumers" && <ConsumersTab item={item} />}
              {tab === "bitwarden" && <BitwardenTab item={item} />}
            </div>
          </>
        )}
      </div>
    </Ctx.Provider>
  );
}
