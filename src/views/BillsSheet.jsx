// Bills sheet (2026-10-04). Jake: wrap the Drive "Bills Tracker.xlsx" in a dashboard tab that
// surfaces what matters without getting busy, lets him add and edit, and goes and checks the
// numbers. Same rows and same edit fields as the Drive workbook (bills-tracker /api/workbook),
// so an edit here lands in the sheet and an edit in the sheet shows here. Every row carries two
// checks: what the bank actually paid (bank) and what the biller has been emailing (mail).
// Replaces the Personal tab (its account-freshness list lives in the footer now).
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { C, BRAND, STATUS, crd } from "../lib/colors";
import { btnS } from "../lib/helpers";

const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const money = (n) => (n == null || n === "" ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const money0 = (n) => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString("en-US"));
const md = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "");
const ago = (iso) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso.length <= 19 && !iso.endsWith("Z") ? iso.replace(" ", "T") + "Z" : iso)) / 60000);
  return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th");
const daysUntil = (day) => {
  if (!day) return null;
  const t = new Date(), dom = t.getDate();
  if (day >= dom) return day - dom;
  return day + new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate() - dom;
};
const amtOf = (r) => (r.adjust ?? r.monthly ?? 0);
const counted = (r) => (r.include === "N" ? 0 : amtOf(r));
const shortAddr = (a) => (!a ? "" : a === "jakemauldin@hotmail.com" ? "hotmail" : a === "jakemauldin@risingcreek.ai" ? "risingcreek.ai" : a);
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u || ""; } };

async function api(url, body) {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function useNarrow() {
  const [n, setN] = useState(typeof window !== "undefined" && window.innerWidth < 760);
  useEffect(() => { const f = () => setN(window.innerWidth < 760); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return n;
}

const TONE = {
  bad: { bg: "rgba(217,108,92,0.12)", bd: "rgba(217,108,92,0.45)", fg: "#F0A397" },
  warn: { bg: "rgba(217,169,59,0.12)", bd: "rgba(217,169,59,0.42)", fg: STATUS.warn },
  good: { bg: "rgba(124,182,92,0.12)", bd: "rgba(124,182,92,0.38)", fg: "#A9D58F" },
  info: { bg: "rgba(255,255,255,0.05)", bd: "rgba(255,255,255,0.12)", fg: C.dim },
};
const pill = (tone = "info") => ({ fontSize: 10.5, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap", fontWeight: 600,
  background: TONE[tone].bg, border: `1px solid ${TONE[tone].bd}`, color: TONE[tone].fg });
const dot = (tone) => ({ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: tone === "bad" ? STATUS.bad : tone === "warn" ? STATUS.warn : tone === "good" ? STATUS.good : "rgba(255,255,255,0.18)", flex: "0 0 auto" });
const input = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "7px 9px", fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
const label = { fontSize: 11, color: C.dim, marginBottom: 4, display: "block" };

function dueChip(r) {
  if (r.status === "Paid") return <span style={pill("good")}>paid</span>;
  if (r.status === "Late") return <span style={pill("bad")}>late</span>;
  const d = daysUntil(r.due_day);
  if (d == null) return <span style={pill()}>no due day</span>;
  if (d <= 3 && r.bank?.verdict !== "stale") return <span style={pill("warn")}>{d === 0 ? "due today" : `due in ${d}d`}</span>;
  return <span style={pill()}>the {ord(r.due_day)}</span>;
}
const accessPill = (a) => a === "AI now" ? <span style={pill("good")}>AI now</span>
  : a === "AI with saved login" ? <span style={pill("good")} title="Bitwarden has the login and AI can read the 2-step code">AI can log in</span>
  : a === "Needs you" ? <span style={pill("warn")}>needs you</span> : <span style={pill()}>not tried</span>;

// Unpaid, due within n days, and still alive at the bank (not "quiet").
const isDue = (r, n) => r.status !== "Paid" && r.bank?.verdict !== "stale" && r.include !== "N"
  && daysUntil(r.due_day) != null && daysUntil(r.due_day) <= n && (r.amount_due > 0 || (r.amount_due == null && r.monthly > 0));

// What deserves Jake's eyes, most urgent first. One line each, never more than one per bill.
function lookFor(r, tab) {
  const n = r.mail?.notice;
  const paidSince = (iso) => r.bank?.last_date && iso && r.bank.last_date >= iso.slice(0, 10);
  if (n?.kind === "late" && !paidSince(n.at)) return { tone: "bad", rank: 0, text: `Late notice ${md(n.at)}: ${n.subject}`, act: "email", msg: n.msg_id };
  if (r.include === "N") return null;
  if (r.mail?.changed && Date.now() - Date.parse(r.mail.changed.at) < 30 * 86400000)
    return { tone: "warn", rank: 1, text: `Its mail now goes to ${r.mail.changed.to} (was ${r.mail.changed.from})` };
  if (n?.kind === "account") return { tone: "warn", rank: 1, text: `Account email ${md(n.at)}: ${n.subject}`, act: "email", msg: n.msg_id };
  const d = daysUntil(r.due_day);
  // Jamie pays her own bills, and a bill the bank hasn't charged in 45+ days is probably gone.
  if (isDue(r, 3) && (tab === "Jamie" || r.tab !== "Jamie") && r.source !== "typed")
    return { tone: "warn", rank: 2, text: `${d === 0 ? "Due today" : `Due in ${d} day${d === 1 ? "" : "s"}`}, ${money(r.amount_due || r.monthly)}`, act: "paid" };
  if (r.bank?.verdict === "off") return { tone: "warn", rank: 3, text: r.bank.text, act: r.key.startsWith("sheet:") && r.bank.last_amount ? "fix" : null };
  if (n?.kind === "invoice" && Date.now() - Date.parse(n.at) < 14 * 86400000) return { tone: "info", rank: 4, text: `Invoice ${md(n.at)}: ${n.subject}`, act: "email", msg: n.msg_id };
  if (r.bank?.verdict === "stale") return { tone: "info", rank: 5, text: `${r.bank.text}. Cancelled?`, act: "drop" };
  return null;
}

export default function BillsSheetView() {
  const narrow = useNarrow();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("due");
  const [filter, setFilter] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const [adding, setAdding] = useState(false);
  const [moreLook, setMoreLook] = useState(false);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(null);
  const [mail, setMail] = useState(null);   // { subject, text } for the open email

  const load = useCallback(async () => {
    try { setData(await api("/api/bills-sheet")); setErr(null); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 90000); return () => clearInterval(t); }, [load]);
  const say = (s) => { setToast(s); setTimeout(() => setToast((x) => (x === s ? null : x)), 6000); };

  // Poll a background job (editor, publish) until it finishes, then reload.
  const pollRef = useRef(null);
  const watchJob = useCallback((name, done) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { jobs } = await api("/api/bills-sheet/jobs");
        const j = jobs?.[name];
        if (j && !j.running && j.finished) { clearInterval(pollRef.current); setBusy(null); await load(); done?.(j); }
      } catch { /* keep polling */ }
    }, 4000);
  }, [load]);
  useEffect(() => () => clearInterval(pollRef.current), []);

  const rows = useMemo(() => data?.rows || [], [data]);
  const inTab = useMemo(() => rows.filter((r) => tab === "all" || r.tab === tab), [rows, tab]);
  // One line per email: a lender's notice that matches two loans (GM Financial) shows once.
  const looks = useMemo(() => {
    const out = [], byMsg = new Map();
    for (const x of inTab.map((r) => ({ r, l: lookFor(r, tab) })).filter((x) => x.l)) {
      if (x.l.msg && byMsg.has(x.l.msg)) { byMsg.get(x.l.msg).also.push(x.r.name); continue; }
      const y = { ...x, also: [] };
      if (x.l.msg) byMsg.set(x.l.msg, y);
      out.push(y);
    }
    return out.sort((a, b) => a.l.rank - b.l.rank || (b.r.mail?.notice?.at || "").localeCompare(a.r.mail?.notice?.at || ""));
  }, [inTab, tab]);
  const shown = useMemo(() => {
    let xs = inTab;
    if (filter === "due7") xs = xs.filter((r) => isDue(r, 7));
    if (filter === "look") { const ks = new Set(looks.map((x) => x.r.key)); xs = xs.filter((r) => ks.has(r.key)); }
    if (filter === "needsyou") xs = xs.filter((r) => r.access === "Needs you");
    if (q.trim()) { const t = q.toLowerCase(); xs = xs.filter((r) => `${r.name} ${r.section} ${r.paid_from} ${r.website} ${r.email_to} ${r.my_notes}`.toLowerCase().includes(t)); }
    const by = { due: (a, b) => (daysUntil(a.due_day) ?? 99) - (daysUntil(b.due_day) ?? 99), big: (a, b) => amtOf(b) - amtOf(a), az: (a, b) => a.name.localeCompare(b.name) }[sort];
    return [...xs].sort(by);
  }, [inTab, filter, looks, q, sort]);

  const act = async (r, kind) => {
    try {
      if (kind === "email") return openEmail(r.mail.notice.box, r.mail.notice.msg_id, r.mail.notice.subject);
      if (kind === "paid") {
        const p = r.pay_ref;
        if (p.via === "sheet") await api("/api/bills-sheet/sheet-paid", { id: p.id, paid: r.status !== "Paid" });
        else await api("/api/personal/bill/paid", { bill_key: p.id, paid: r.status !== "Paid" });
        say(r.status === "Paid" ? `${r.name} reopened.` : `${r.name} marked paid.`);
      }
      if (kind === "fix") {
        await api("/api/bills-sheet/sheet-row", { id: Number(r.key.slice(6)), patch: { monthly: r.bank.last_amount } });
        say(`${r.name} now ${money(r.bank.last_amount)} a month on the sheet.`);
      }
      if (kind === "drop") { await api("/api/bills-sheet/row", { key: r.key, patch: { include: "N" } }); say(`${r.name} no longer counted. Put it back from its details.`); }
      await load();
    } catch (e) { say(`That didn't work: ${e.message}`); }
  };
  const openEmail = async (box, id, subject) => {
    setMail({ subject, text: "Opening…" });
    try { const j = await api(`/api/bills-sheet/email?box=${encodeURIComponent(box)}&id=${encodeURIComponent(id)}`); setMail({ subject, text: j.text }); }
    catch (e) { setMail({ subject, text: `Couldn't open it: ${e.message}` }); }
  };
  const runEditor = async (key) => {
    const name = key ? `editor:${key}` : "editor";
    setBusy(name);
    try {
      await api("/api/bills-sheet/editor", key ? { key } : {});
      say(key ? "Re-checking this bill's website, login and email. About a minute." : "Re-reading both mailboxes and refreshing the Drive sheet. A minute or two.");
      watchJob(name, (j) => say(j.ok ? "Done. Everything below is fresh." : "The check hit a problem. Details are in the bills-tracker log."));
    } catch (e) { setBusy(null); say(`Couldn't start it: ${e.message}`); }
  };
  const syncBank = async () => {
    setBusy("sync"); say("Pulling the bank feed. 10 to 40 seconds.");
    try { const r = await api("/api/personal/sync", {}); say(r.ok ? "Bank feed is current." : "The bank sync had trouble. Try again in a bit."); await load(); }
    catch (e) { say(`Sync failed: ${e.message}`); }
    finally { setBusy(null); }
  };

  if (err && !data) return <div style={{ ...crd, padding: 22, color: C.dim }}>Can't reach the bills tracker ({err}).</div>;
  if (!data) return <div style={{ ...crd, padding: 22, color: C.dim }}>Loading bills…</div>;

  const tabCount = (t) => rows.filter((r) => t === "all" || r.tab === t).length;
  const monthly = inTab.reduce((n, r) => n + counted(r), 0);
  const due7 = inTab.filter((r) => isDue(r, 7));
  const due7amt = due7.reduce((n, r) => n + (r.amount_due ?? amtOf(r) ?? 0), 0);
  const needsYou = inTab.filter((r) => r.access === "Needs you").length;
  const saved = inTab.filter((r) => r.include === "N").reduce((n, r) => n + amtOf(r), 0);
  const pub = data.jobs?.publish;
  const sheetState = pub?.queued_for || pub?.running ? "saving to the Drive sheet…" : `Drive sheet saved ${ago(data.sheet_published_at)}`;
  const open = rows.find((r) => r.key === openKey);

  const Tile = ({ id, label: l, value, sub, tone }) => (
    <button onClick={() => setFilter(filter === id ? null : id)} disabled={!id}
      style={{ ...crd, padding: "14px 16px", textAlign: "left", cursor: id ? "pointer" : "default", flex: "1 1 160px", minWidth: 150,
        borderColor: filter === id ? BRAND.link : C.border, fontFamily: "inherit" }}>
      <div style={{ fontSize: 11, color: C.dim, letterSpacing: 0.3 }}>{l}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone ? TONE[tone].fg : C.bright, fontFamily: MONO, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{sub}</div>}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.bright, margin: 0 }}>Bills</h2>
        <span style={{ fontSize: 11.5, color: C.dim }}>
          bank {ago(data.last_sync?.ts)} · email {ago(data.email_scan_last)} · {sheetState}
        </span>
        <span style={{ flex: 1 }} />
        {data.sheet_url && <a href={data.sheet_url} target="_blank" rel="noopener noreferrer" style={{ ...btnS(false), textDecoration: "none" }}>Open in Google Sheets ↗</a>}
        <button style={btnS(false)} disabled={!!busy} onClick={syncBank}>{busy === "sync" ? "Syncing…" : "Sync bank"}</button>
        <button style={btnS(false)} disabled={!!busy} onClick={() => runEditor(null)} title="Re-read both mailboxes for every bill, then refresh the Drive sheet">{busy === "editor" ? "Checking…" : "Check email"}</button>
        <button style={btnS(true)} onClick={() => setAdding(true)}>+ Add bill</button>
      </div>
      {toast && <div style={{ ...crd, padding: "9px 14px", fontSize: 12.5, color: C.text, borderColor: BRAND.border }}>{toast}</div>}

      {/* tiles */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Tile label="Counted per month" value={money0(monthly)} sub={saved ? `${money0(saved)}/mo left out` : `${money0(monthly * 12)} a year`} />
        <Tile id="due7" label="Due in the next 7 days" value={money0(due7amt)} sub={`${due7.length} bill${due7.length === 1 ? "" : "s"}`} tone={due7.length ? "warn" : null} />
        <Tile id="look" label="Worth a look" value={looks.length} sub="notices, price changes, quiet bills" tone={looks.some((x) => x.l.tone === "bad") ? "bad" : looks.length ? "warn" : null} />
        <Tile id="needsyou" label="Logins that need you" value={needsYou} sub="AI can't get in alone" />
      </div>

      {/* worth a look */}
      {looks.length > 0 && (
        <div style={{ ...crd, padding: "12px 16px" }}>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>Worth a look</div>
          {(moreLook ? looks : looks.slice(0, 5)).map(({ r, l, also }) => (
            <div key={r.key} style={{ display: narrow ? "grid" : "flex", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: narrow ? "4px 10px" : 10, padding: "7px 0", borderTop: `1px solid ${C.border}` }}>
              <span style={dot(l.tone)} />
              <button onClick={() => setOpenKey(r.key)} style={{ background: "none", border: "none", padding: 0, color: C.bright, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }} title={also.length ? `Same email matches ${also.join(", ")}` : ""}>{r.name}{also.length ? ` +${also.length}` : ""}</button>
              <span style={{ fontSize: 12.5, color: C.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: narrow ? "normal" : "nowrap",
                gridColumn: narrow ? "2 / 4" : undefined, gridRow: narrow ? 2 : undefined }}>{l.text}</span>
              {l.act === "email" && <button style={btnS(false)} onClick={() => act(r, "email")}>Read it</button>}
              {l.act === "paid" && r.pay_ref && <button style={btnS(false)} onClick={() => act(r, "paid")}>Mark paid</button>}
              {l.act === "fix" && <button style={btnS(false)} onClick={() => act(r, "fix")}>Use {money(r.bank.last_amount)}</button>}
              {l.act === "drop" && <button style={btnS(false)} onClick={() => act(r, "drop")}>Stop counting</button>}
            </div>
          ))}
          {looks.length > 5 && <button style={{ ...btnS(false), marginTop: 6 }} onClick={() => setMoreLook(!moreLook)}>{moreLook ? "Show fewer" : `Show all ${looks.length}`}</button>}
        </div>
      )}

      {/* list */}
      <div style={{ ...crd, padding: narrow ? 10 : 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          {[["all", "Everything"], ["Bills", "Mine"], ["Business", "Business"], ["Jamie", "Jamie"]].map(([t, l]) => (
            <button key={t} style={btnS(tab === t)} onClick={() => setTab(t)}>{l} <span style={{ opacity: 0.6 }}>{tabCount(t)}</span></button>
          ))}
          {filter && <button style={{ ...btnS(false), color: BRAND.link }} onClick={() => setFilter(null)}>✕ {({ due7: "due in 7 days", look: "worth a look", needsyou: "logins that need you" })[filter]}</button>}
          <span style={{ flex: 1 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" style={{ ...input, width: narrow ? "100%" : 180, padding: "5px 9px" }} />
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ ...input, width: "auto", padding: "5px 8px" }}>
            <option value="due">Due soonest</option><option value="big">Biggest</option><option value="az">A to Z</option>
          </select>
        </div>
        {!narrow && (
          <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, fontSize: 10.5, color: C.dim, padding: "0 6px 6px", textTransform: "uppercase", letterSpacing: 0.5 }}>
            <span>Bill</span><span>Due</span><span style={{ textAlign: "right" }}>Per month</span><span>Bank</span><span>Emails go to</span><span>Login</span>
          </div>
        )}
        {shown.map((r) => <Row key={r.key} r={r} narrow={narrow} onOpen={() => setOpenKey(r.key)} />)}
        {!shown.length && <div style={{ color: C.dim, fontSize: 13, padding: 12 }}>Nothing here.</div>}
      </div>

      {/* sources */}
      <details style={{ ...crd, padding: "12px 16px" }}>
        <summary style={{ fontSize: 12, color: C.dim, cursor: "pointer" }}>Where the numbers come from{data.stale_accounts?.length ? ` · ${data.stale_accounts.length} bank links quiet for a week` : ""}</summary>
        <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.7, marginTop: 8 }}>
          Amounts and paid status come from the bank feed (SimpleFIN, synced 3 times a day), statements for loans and cards, and bills typed in by hand.
          "Bank" compares each bill to what actually left the account. "Emails go to" is read from both mailboxes after every sync, and a late notice is double-checked by AI before it shows here.
          Logins are checked Sundays (last {ago(data.audit_last)}; Bitwarden list from {data.vault_as_of || "unknown"}).
          Edits here and in the Drive sheet are the same fields, so either place works.
          {data.stale_accounts?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <span style={{ color: STATUS.warn }}>No new transactions in 7+ days:</span>{" "}
              {data.stale_accounts.map((a) => `${a.name} (${a.last_txn ? md(a.last_txn) : "never"})`).join(", ")}. A dead bank link is fixed in SimpleFIN with that bank's login.
            </div>
          )}
        </div>
      </details>

      {open && <Drawer r={open} data={data} narrow={narrow} busy={busy} onClose={() => setOpenKey(null)} onSaved={async (s) => { say(s); await load(); }}
        onAct={act} onEditor={runEditor} onEmail={openEmail} />}
      {adding && <AddBill sections={data.sections} narrow={narrow} onClose={() => setAdding(false)} onAdded={async (name) => { setAdding(false); say(`${name} added. It's on the Drive sheet in about a minute.`); await load(); }} />}
      {mail && <Modal narrow={narrow} title={mail.subject} onClose={() => setMail(null)}><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12.5, color: C.text, margin: 0 }}>{mail.text}</pre></Modal>}
    </div>
  );
}

const GRID = "minmax(200px, 2.2fr) 92px 110px minmax(120px, 1.4fr) minmax(110px, 1fr) 104px";

function bankTone(b) { return b?.verdict === "off" ? "warn" : b?.verdict === "stale" ? "info" : b?.verdict === "ok" ? "good" : null; }

function Row({ r, narrow, onOpen }) {
  const grey = r.include === "N";
  const late = r.mail?.notice?.kind === "late";
  const amt = (
    <span style={{ fontFamily: MONO, fontSize: 13, color: grey ? C.dim : C.bright, textDecoration: grey ? "line-through" : "none" }}>
      {r.adjust != null ? <><span style={{ color: C.dim, textDecoration: "line-through", marginRight: 4 }}>{money0(r.monthly)}</span>{money(r.adjust)}</> : money(r.monthly)}
    </span>
  );
  const bank = r.bank?.verdict && r.bank.verdict !== "none"
    ? <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }} title={r.bank.text}><span style={dot(bankTone(r.bank))} /><span style={{ fontSize: 11.5, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.bank.verdict === "ok" ? (r.bank.last_date ? `last ${md(r.bank.last_date)}` : "matches") : r.bank.verdict === "off" ? "doesn't match" : "quiet"}</span></span>
    : <span style={{ fontSize: 11.5, color: C.dim, opacity: 0.6 }}>—</span>;
  const email = <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }} title={r.email_latest || ""}>{late && <span style={dot("bad")} />}<span style={{ fontSize: 11.5, color: r.email_to ? C.text : C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortAddr(r.email_to) || "no mail seen"}</span></span>;
  if (narrow) {
    return (
      <button onClick={onOpen} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: `1px solid ${C.border}`, padding: "10px 4px", cursor: "pointer", fontFamily: "inherit", opacity: grey ? 0.55 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.bright, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
          {amt}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
          {dueChip(r)}{accessPill(r.access)}{bank}{late && <span style={pill("bad")}>late notice</span>}
        </div>
      </button>
    );
  }
  return (
    <button onClick={onOpen} style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "center", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: `1px solid ${C.border}`, padding: "9px 6px", cursor: "pointer", fontFamily: "inherit", opacity: grey ? 0.55 : 1 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.bright, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
        <span style={{ display: "block", fontSize: 11, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.section.toLowerCase()}{r.paid_from ? ` · ${r.paid_from}` : ""}</span>
      </span>
      <span>{dueChip(r)}</span>
      <span style={{ textAlign: "right" }}>{amt}</span>
      {bank}
      {email}
      <span>{accessPill(r.access)}</span>
    </button>
  );
}

function Modal({ title, children, onClose, narrow, width = 560 }) {
  useEffect(() => { const f = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 60, display: "flex", justifyContent: "center", alignItems: narrow ? "stretch" : "center", padding: narrow ? 0 : 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...crd, width: narrow ? "100%" : width, maxWidth: "100%", maxHeight: narrow ? "100%" : "85vh", overflowY: "auto", borderRadius: narrow ? 0 : 12, padding: 18, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.bright, flex: 1 }}>{title}</div>
          <button style={btnS(false)} onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Block({ title, children, right }) {
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 0" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, flex: 1 }}>{title}</span>{right}
      </div>
      {children}
    </div>
  );
}

const KIND = { late: ["bad", "late"], invoice: ["info", "invoice"], due: ["info", "due"], paid: ["good", "paid"], account: ["warn", "account"], other: ["info", "other"] };

function Drawer({ r, data, narrow, busy, onClose, onSaved, onAct, onEditor, onEmail }) {
  const init = { adjust: r.adjust ?? "", include: r.include !== "N", website: r.edited?.website ? r.website : "", access: r.edited?.access ? r.access : "", human_step: r.edited?.human_step ? r.human_step : "", my_notes: r.my_notes || "" };
  const [f, setF] = useState(init);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setF(init); }, [r.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const save = async () => {
    setSaving(true);
    try {
      const patch = { adjust: f.adjust, include: f.include ? "Y" : "N", website: f.website, access: f.access, human_step: f.human_step, my_notes: f.my_notes };
      await api("/api/bills-sheet/row", { key: r.key, patch });
      await onSaved(`Saved ${r.name}. The Drive sheet picks it up in about a minute.`);
    } catch (e) { await onSaved(`Couldn't save: ${e.message}`); }
    finally { setSaving(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const editing = busy === `editor:${r.key}`;
  const fact = (l, v) => v == null || v === "" ? null : <div style={{ minWidth: 92 }}><div style={label}>{l}</div><div style={{ fontSize: 13, color: C.bright, fontFamily: typeof v === "string" && v.startsWith("$") ? MONO : "inherit" }}>{v}</div></div>;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderLeft: `1px solid ${C.border}`, width: narrow ? "100%" : 480, height: "100%", overflowY: "auto", padding: "18px 20px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.bright }}>{r.name}</div>
            <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>{({ Bills: "Mine", Business: "Business", Jamie: "Jamie" })[r.tab]} · {r.section.toLowerCase()} · {({ bank: "found in the bank feed", statement: "from statements", manual: "typed in", typed: "typed in, no live source" })[r.source] || r.source}</div>
          </div>
          <button style={btnS(false)} onClick={onClose}>Close</button>
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "14px 0 10px" }}>
          {fact("Per month", money(r.monthly))}
          {fact("Due day", r.due_day ? String(r.due_day) : "—")}
          {fact("Due now", r.amount_due != null ? money(r.amount_due) : null)}
          {fact("Balance", r.balance != null ? money(r.balance) : null)}
          {fact("Rate", r.rate != null ? `${r.rate}%` : null)}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
          {dueChip(r)}
          {r.paid_from && <span style={{ fontSize: 11.5, color: C.dim }}>paid from {r.paid_from}</span>}
          <span style={{ flex: 1 }} />
          {r.pay_ref && r.source !== "typed" && <button style={btnS(false)} onClick={() => onAct(r, "paid")}>{r.status === "Paid" ? "Mark not paid" : "Mark paid"}</button>}
          {r.website && <a href={r.website} target="_blank" rel="noopener noreferrer" style={{ ...btnS(false), textDecoration: "none" }}>{domain(r.website)} ↗</a>}
        </div>

        <Block title="Bank check">
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            {bankTone(r.bank) && <span style={dot(bankTone(r.bank))} />}
            <span style={{ fontSize: 13, color: C.text }}>{r.bank?.text || "Nothing to check against."}</span>
          </div>
          {r.bank?.verdict === "off" && r.key.startsWith("sheet:") && r.bank.last_amount && (
            <button style={{ ...btnS(false), marginTop: 8 }} onClick={() => onAct(r, "fix")}>Update the sheet to {money(r.bank.last_amount)}</button>
          )}
          {r.bank?.charges?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {r.bank.charges.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 10, fontSize: 12, color: C.dim, padding: "2px 0" }}>
                  <span style={{ width: 44 }}>{md(c.date)}</span><span style={{ fontFamily: MONO, color: C.text, width: 90, textAlign: "right" }}>{money(c.amount)}</span><span>{c.account}</span>
                </div>
              ))}
            </div>
          )}
        </Block>

        <Block title="Email">
          {r.mail ? (
            <>
              <div style={{ fontSize: 13, color: C.text }}>Mail from them goes to <b style={{ color: C.bright }}>{r.mail.to || "unknown"}</b>
                {Object.keys(r.mail.to_counts || {}).length > 1 && <span style={{ color: C.dim }}> (also {Object.entries(r.mail.to_counts).filter(([a]) => a !== r.mail.to).map(([a, n]) => `${a} ×${n}`).join(", ")})</span>}
              </div>
              {r.mail.changed && <div style={{ fontSize: 12.5, color: STATUS.warn, marginTop: 4 }}>Changed {md(r.mail.changed.at)}: it used to go to {r.mail.changed.from}.</div>}
              <div style={{ marginTop: 8 }}>
                {r.mail.recent.map((m) => (
                  <button key={m.box + m.msg_id} onClick={() => onEmail(m.box, m.msg_id, m.subject)} style={{ display: "flex", gap: 8, alignItems: "center", width: "100%", background: "none", border: "none", padding: "4px 0", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                    <span style={{ fontSize: 11.5, color: C.dim, width: 40 }}>{md(m.received_at)}</span>
                    <span style={pill(KIND[m.kind]?.[0])}>{KIND[m.kind]?.[1] || m.kind}</span>
                    <span style={{ fontSize: 12.5, color: C.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subject}</span>
                  </button>
                ))}
              </div>
            </>
          ) : <div style={{ fontSize: 13, color: C.dim }}>No mail from this biller in either mailbox in the last 4 months.{r.website ? "" : " Adding its website helps match it."}</div>}
        </Block>

        <Block title="Getting in">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{accessPill(r.access)}<span style={{ fontSize: 12.5, color: C.text }}>{r.human_step}</span></div>
          {r.fix && <div style={{ fontSize: 12.5, color: C.dim, marginTop: 6 }}>To make it AI-ready: {r.fix}</div>}
          <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>{r.saved_login ? `Bitwarden: ${r.saved_login}` : ""}{r.checked ? ` · checked ${r.checked}` : ""}</div>
          <button style={{ ...btnS(false), marginTop: 10 }} disabled={!!busy} onClick={() => onEditor(r.key)}>{editing ? "Checking website, login and email…" : "Re-check this bill"}</button>
        </Block>

        <Block title="Your columns" right={dirty && <button style={btnS(true)} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label><span style={label}>Adjust $/mo (try a number)</span><input style={input} inputMode="decimal" value={f.adjust} onChange={set("adjust")} placeholder={r.monthly != null ? String(r.monthly) : ""} /></label>
            <label style={{ display: "flex", alignItems: "flex-end", gap: 8, paddingBottom: 8 }}><input type="checkbox" checked={f.include} onChange={set("include")} /><span style={{ fontSize: 12.5, color: C.text }}>Count it in the totals</span></label>
            <label style={{ gridColumn: "1 / -1" }}><span style={label}>Website {r.edited?.website ? "" : `(found: ${domain(r.website) || "none"})`}</span><input style={input} value={f.website} onChange={set("website")} placeholder={r.website || "https://"} /></label>
            <label><span style={label}>Who can get in</span>
              <select style={input} value={f.access} onChange={set("access")}><option value="">{`Auto (${r.access})`}</option>{data.access_options.map((o) => <option key={o}>{o}</option>)}</select></label>
            <label><span style={label}>What you have to do</span>
              <select style={input} value={f.human_step} onChange={set("human_step")}><option value="">Auto</option>{data.step_options.map((o) => <option key={o}>{o}</option>)}</select></label>
            <label style={{ gridColumn: "1 / -1" }}><span style={label}>My notes</span><textarea style={{ ...input, minHeight: 64, resize: "vertical" }} value={f.my_notes} onChange={set("my_notes")} /></label>
          </div>
          {r.notes && <div style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>System notes: {r.notes}</div>}
        </Block>
      </div>
    </div>
  );
}

function AddBill({ sections, narrow, onClose, onAdded }) {
  const [f, setF] = useState({ name: "", amount: "", frequency: "monthly", due_day: "", tab: "Bills", section: "OTHER", website: "", notes: "" });
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    if (!f.name.trim() || f.amount === "" || Number.isNaN(Number(f.amount))) return setErr("A name and an amount, please.");
    setSaving(true);
    try { await api("/api/bills-sheet/add", { ...f, amount: Number(f.amount), due_day: f.due_day ? Number(f.due_day) : null }); await onAdded(f.name.trim()); }
    catch (e) { setErr(e.message); setSaving(false); }
  };
  return (
    <Modal title="Add a bill" narrow={narrow} onClose={onClose} width={460}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={{ gridColumn: "1 / -1" }}><span style={label}>Name</span><input style={input} value={f.name} onChange={set("name")} autoFocus /></label>
        <label><span style={label}>Amount</span><input style={input} inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="0.00" /></label>
        <label><span style={label}>How often</span><select style={input} value={f.frequency} onChange={set("frequency")}>
          {["monthly", "quarterly", "annual", "weekly"].map((o) => <option key={o}>{o}</option>)}</select></label>
        <label><span style={label}>Due day of month</span><input style={input} inputMode="numeric" value={f.due_day} onChange={set("due_day")} placeholder="1 to 31" /></label>
        <label><span style={label}>Whose</span><select style={input} value={f.tab} onChange={set("tab")}>
          <option value="Bills">Mine</option><option value="Business">Business</option><option value="Jamie">Jamie</option></select></label>
        {f.tab === "Bills" && <label style={{ gridColumn: "1 / -1" }}><span style={label}>Section</span><select style={input} value={f.section} onChange={set("section")}>
          {sections.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select></label>}
        <label style={{ gridColumn: "1 / -1" }}><span style={label}>Website (optional)</span><input style={input} value={f.website} onChange={set("website")} placeholder="https://" /></label>
        <label style={{ gridColumn: "1 / -1" }}><span style={label}>Notes (optional)</span><input style={input} value={f.notes} onChange={set("notes")} /></label>
      </div>
      {err && <div style={{ color: STATUS.bad, fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button style={btnS(false)} onClick={onClose}>Cancel</button>
        <button style={btnS(true)} disabled={saving} onClick={submit}>{saving ? "Adding…" : "Add it"}</button>
      </div>
    </Modal>
  );
}
