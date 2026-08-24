// Personal bills (2026-08-24): Jake — "I need my personal bills on a tab ... it goes stale
// instantly and i'm not sure of the truth sources." The truth was never stale — the old view
// asked the wrong dimension (bucket=Personal, repurposed by the FCC rework) while klass held
// Personal/Business/Jamie. This tab asks the right question AND shows its sources: every
// account with its last-transaction date (so a frozen bank link is visible, not silent),
// the last sync time with a Sync-now button, and a source tag on every row (detected from
// transactions / manual / statement-extracted debt with its as-of date).
// Data lives in ~/services/bills-tracker (SimpleFIN → SQLite, one writer); this page only
// talks to /api/personal/* proxies in server/api.js.
import { useState, useEffect, useCallback } from "react";
import { C, BRAND, STATUS } from "../lib/colors";
import { btnS } from "../lib/helpers";
import { Section } from "../components/ui/Card";

const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const money = (n) => (n == null ? "—" : (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const money0 = (n) => (n == null ? "—" : "$" + Math.round(Math.abs(n)).toLocaleString());
const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso + (iso.length <= 10 ? "T12:00:00" : "")).getTime()) / 86400000) : null);
const agoStr = (iso) => { const d = daysAgo(iso); return d == null ? "never" : d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`; };

const chip = (tone) => ({
  fontSize: 10, padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap", fontWeight: 600,
  background: tone === "bad" ? "rgba(220,38,38,0.12)" : tone === "warn" ? "rgba(217,169,59,0.12)" : tone === "good" ? "rgba(42,157,143,0.12)" : "rgba(255,255,255,0.05)",
  border: `1px solid ${tone === "bad" ? "rgba(220,38,38,0.4)" : tone === "warn" ? "rgba(217,169,59,0.4)" : tone === "good" ? "rgba(42,157,143,0.35)" : "rgba(255,255,255,0.12)"}`,
  color: tone === "bad" ? "#FCA5A5" : tone === "warn" ? STATUS.warn : tone === "good" ? "#A7F3D0" : C.dim,
});
const noteS = { fontSize: 12, color: C.text, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8, whiteSpace: "pre-wrap" };

function StatusChip({ r }) {
  if (r.paid_this_cycle) return <span style={chip("good")}>paid</span>;
  if (r.past_due) return <span style={chip("bad")}>past due</span>;
  if (r.days_until != null && r.days_until <= 7) return <span style={chip("warn")}>due {r.days_until <= 0 ? "now" : `in ${r.days_until}d`}</span>;
  return <span style={chip()}>due {r.due_date || "—"}</span>;
}

function BillRow({ r, busy, onPaid }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.bright, flex: "0 1 auto" }}>{r.name}</span>
      <StatusChip r={r} />
      <span style={chip()}>{r.source === "manual" ? "manual" : "detected"}</span>
      {r.klass === "Jamie" && <span style={chip()}>Jamie</span>}
      <span style={{ flex: 1, minWidth: 120, fontSize: 11, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {r.category || r.bucket}{r.account ? ` · ${r.account}` : ""}{r.last_date ? ` · last paid ${r.last_date}` : ""}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 13, color: C.bright }}>{money(r.amount)}</span>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.dim, width: 76, textAlign: "right" }}>{r.frequency || ""}</span>
      <button style={btnS(false)} disabled={busy} onClick={() => onPaid(r)} title={r.paid_this_cycle ? "un-mark" : "mark paid this cycle (writes to bills-tracker)"}>
        {r.paid_this_cycle ? "Undo" : "Paid"}
      </button>
    </div>
  );
}

export default function PersonalBillsView() {
  const [bills, setBills] = useState(null);
  const [summary, setSummary] = useState(null);
  const [debts, setDebts] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [err, setErr] = useState(null);
  const [klass, setKlass] = useState("household");
  const [showPaid, setShowPaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    try {
      const [b, s, d, a] = await Promise.all([
        fetch(`/api/personal/bills?klass=${klass}&status=active&sort=due`).then((r) => r.json()),
        fetch(`/api/personal/summary?klass=${klass}`).then((r) => r.json()),
        fetch("/api/personal/debts").then((r) => r.json()),
        fetch("/api/personal/accounts").then((r) => r.json()),
      ]);
      if (b.error || b.fallback) throw new Error(b.error || "bills unavailable");
      setBills(Array.isArray(b) ? b : b.bills || []);
      setSummary(s);
      setDebts((d.debts || []).filter((x) => (x.klass || "").toLowerCase() !== "business"));
      setAccounts(a);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, [klass]);
  useEffect(() => { load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, [load]);

  const markPaid = async (r) => {
    setBusy(true);
    try {
      const resp = await fetch("/api/personal/bill/paid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bill_key: r.id, paid: !r.paid_this_cycle }) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await load();
    } catch (e) { setNote(`Mark failed: ${e.message}`); }
    finally { setBusy(false); }
  };

  const syncNow = async () => {
    setBusy(true); setNote("Syncing from SimpleFIN… ~10-40s.");
    try {
      const r = await fetch("/api/personal/sync", { method: "POST" });
      const body = await r.json();
      setNote((body.ok ? "Synced.\n" : "Sync had trouble:\n") + (body.output || "").split("\n").slice(-6).join("\n"));
      await load();
    } catch (e) { setNote(`Sync failed: ${e.message}`); }
    finally { setBusy(false); }
  };

  if (err) return <Section title="Personal bills"><div style={{ color: C.dim }}>{err} — bills-tracker (:3230) may be down.</div></Section>;
  if (!bills) return <Section title="Personal bills"><div style={{ color: C.dim }}>Loading…</div></Section>;

  const shown = showPaid ? bills : bills.filter((r) => !r.paid_this_cycle);
  const pastDue = bills.filter((r) => r.past_due && !r.paid_this_cycle);
  const staleAccounts = (accounts?.accounts || []).filter((a) => a.balance !== 0 && (daysAgo(a.last_txn) == null || daysAgo(a.last_txn) > 7));
  const debtTotal = (debts || []).reduce((n, d) => n + (d.balance ? Math.abs(d.balance) : 0), 0);
  const debtMonthly = (debts || []).reduce((n, d) => n + (d.monthly_payment || 0), 0);
  const lastSync = accounts?.last_sync?.ts;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Personal bills">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          {["household", "Personal", "Jamie"].map((k) => (
            <button key={k} style={btnS(klass === k)} onClick={() => setKlass(k)}>{k === "household" ? "All personal" : k}</button>
          ))}
          <span style={{ fontSize: 12, color: C.dim }}>
            {money0(summary?.total_monthly)}/mo across {bills.length} bills · {pastDue.length ? `${pastDue.length} past due (${money0(pastDue.reduce((n, r) => n + (r.amount || 0), 0))})` : "nothing past due"}
          </span>
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 12, color: C.dim, display: "flex", gap: 5, alignItems: "center" }}>
            <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} /> show paid
          </label>
          <button style={btnS(true)} disabled={busy} onClick={syncNow}>{busy ? "Working…" : "Sync now"}</button>
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginBottom: 6 }}>
          Truth sources: SimpleFIN bank feed (auto, synced 3×/day — last {lastSync ? `${lastSync} · ${accounts.last_sync.txns_added} txns` : "unknown"}), manual bills, and statement-extracted debts.
          A bill reads "paid" when a matching charge lands or you mark it. Pending charges post 1–3 days late — that lag is the bank, not the tracker.
        </div>
        {note && <div style={{ ...noteS, marginBottom: 6 }}>{note}<button style={{ ...btnS(false), marginLeft: 10 }} onClick={() => setNote(null)}>Dismiss</button></div>}
        {shown.map((r) => <BillRow key={r.id} r={r} busy={busy} onPaid={markPaid} />)}
      </Section>

      <Section title="Accounts feeding this page">
        {staleAccounts.length > 0 && (
          <div style={{ ...noteS, marginBottom: 8, border: "1px solid rgba(217,169,59,0.4)" }}>
            {staleAccounts.length} account{staleAccounts.length > 1 ? "s" : ""} stale (no transactions in 7+ days). GM Financial needs its bank link re-authorized in SimpleFIN — that one is a Jake-only fix (bank login).
          </div>
        )}
        {(accounts?.accounts || []).map((a) => {
          const d = daysAgo(a.last_txn);
          const stale = a.balance !== 0 && (d == null || d > 7);
          return (
            <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.bright, flex: "1 1 240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
              {stale ? <span style={chip("bad")}>stale · last txn {agoStr(a.last_txn)}</span> : <span style={chip("good")}>fresh · {agoStr(a.last_txn)}</span>}
              <span style={{ fontFamily: MONO, fontSize: 12, color: a.balance < 0 ? "#FCA5A5" : C.text }}>{money(a.balance)}</span>
            </div>
          );
        })}
      </Section>

      <Section title="Debts (statement truth — each shows its as-of date)">
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>
          {money0(debtTotal)} total balance · {money0(debtMonthly)}/mo in payments. Due dates here come from statements/extraction, not the bank feed — an old "as of" means the row needs a fresh statement, not that you missed a payment.
        </div>
        {(debts || []).map((d) => {
          const asOfDays = daysAgo((d.updated_at || "").slice(0, 10));
          return (
            <div key={d.key} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.bright, flex: "1 1 260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              <span style={chip()}>{d.type}</span>
              {d.past_due ? <span style={chip(asOfDays != null && asOfDays > 35 ? "warn" : "bad")}>{asOfDays != null && asOfDays > 35 ? "as-of stale" : "past due"}</span> : null}
              <span style={{ fontSize: 11, color: C.dim }}>{d.interest_rate != null ? `${d.interest_rate}% · ` : ""}{d.monthly_payment ? `${money0(d.monthly_payment)}/mo · ` : ""}due {d.next_due || "—"} · as of {d.updated_at ? d.updated_at.slice(0, 10) : "?"}</span>
              <span style={{ fontFamily: MONO, fontSize: 13, color: C.bright, marginLeft: "auto" }}>{money0(d.balance)}</span>
            </div>
          );
        })}
      </Section>

      <Section title="Where the numbers come from">
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.7 }}>
          <b style={{ color: BRAND.link }}>Detected bills</b> — recurring charges found in the SimpleFIN transaction feed (16 accounts, synced 06:45 / 14:45 / 22:45, or the Sync now button). Self-healing: a paid bill flips to "paid" when the charge posts.<br />
          <b style={{ color: BRAND.link }}>Manual bills</b> — fixed entries kept in bills-tracker for things the feed can't see (AT&T bill-pay, the GM notes while that link is down). Mark them Paid by hand.<br />
          <b style={{ color: BRAND.link }}>Debts</b> — balances and due dates from statements; trust the "as of" date, not the past-due flag, when they disagree.<br />
          Full tracker (business side, cancellations, audits): <a href="http://100.92.25.23:3230" target="_blank" rel="noopener noreferrer" style={{ color: BRAND.link }}>bills-tracker ↗</a>
        </div>
      </Section>
    </div>
  );
}
