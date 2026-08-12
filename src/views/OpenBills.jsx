import { useEffect, useState, useCallback, useMemo } from "react";
import { C, crd, inn } from "../lib/colors";
import { btnS, badge } from "../lib/helpers";

const fmt = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

export default function OpenBillsView({ jobs }) {
  const [pending, setPending] = useState([]);
  const [openBills, setOpenBills] = useState([]);
  const [confirmed, setConfirmed] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [expanded, setExpanded] = useState(null); // pending id under edit

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, o] = await Promise.all([
        api("/api/ap/pending-bills"),
        api("/api/ap/open-bills"),
      ]);
      if (p.success) {
        setPending(p.pending || []);
        setConfirmed(p.confirmed || []);
        setRejected(p.rejected || []);
      } else {
        setError(p.error || "pending-bills fetch failed");
      }
      if (o.success) setOpenBills(o.bills || []);
      else setError((prev) => prev || o.error || "open-bills fetch failed");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [refresh]);

  const counts = useMemo(() => ({
    pending: pending.length,
    needsAmount: pending.filter((p) => !p.amount).length,
    open: openBills.length,
    dueSoon: openBills.filter((b) => b.daysUntilDue != null && b.daysUntilDue <= 7).length,
    overdue: openBills.filter((b) => b.daysUntilDue != null && b.daysUntilDue < 0).length,
    openTotal: openBills.reduce((s, b) => s + (b.balance || 0), 0),
  }), [pending, openBills]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header strip */}
      <div style={crd}>
        <div style={{ padding: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: C.bright, margin: 0 }}>
                AP — Path A Vendor Bills
              </h2>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                Lien-release-driven bills (gross amount, due before wire). Path B (cards/Zelle) still goes through the swipe deck.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowManual(true)} style={btnS(true)}>+ New Bill</button>
              <button onClick={refresh} disabled={loading} style={btnS(false)}>
                {loading ? "…" : "Refresh"}
              </button>
            </div>
          </div>

          {/* Counters */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Stat label="Awaiting confirm" value={counts.pending} sub={counts.needsAmount ? `${counts.needsAmount} need amount` : null}
                  color={counts.pending ? "#FDE68A" : C.dim} />
            <Stat label="Open bills" value={counts.open} sub={fmt(counts.openTotal)} color="#4A90D9" />
            <Stat label="Due ≤ 7 days" value={counts.dueSoon} color={counts.dueSoon ? "#E8722A" : C.dim} />
            <Stat label="Overdue" value={counts.overdue} color={counts.overdue ? "#DC2626" : C.dim} />
          </div>

          {error && (
            <div style={{ ...inn, marginTop: 12, background: "rgba(220,38,38,0.06)", borderColor: "rgba(220,38,38,0.25)", color: "#FCA5A5", fontSize: 11 }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Manual New Bill form */}
      {showManual && (
        <ManualBillForm
          jobs={jobs}
          onClose={() => setShowManual(false)}
          onCreated={async () => { setShowManual(false); await refresh(); }}
        />
      )}

      {/* Pending confirm queue */}
      <Card title={`Awaiting Confirm (${pending.length})`} subtitle="DocuSign envelopes detected by the poller + manual submissions. Click to confirm or reject.">
        {pending.length === 0 ? (
          <Empty>No pending bills.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pending.map((p) => (
              <PendingRow
                key={p.id}
                entry={p}
                jobs={jobs}
                expanded={expanded === p.id}
                onExpand={() => setExpanded(expanded === p.id ? null : p.id)}
                onConfirmed={refresh}
                onRejected={refresh}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Open JT bills */}
      <Card title={`Open Bills (${openBills.length})`} subtitle="JT vendor bills with balance > 0. Soonest-due first.">
        {openBills.length === 0 ? (
          <Empty>No open bills.</Empty>
        ) : (
          <OpenBillsTable bills={openBills} />
        )}
      </Card>

      {/* Recent confirms / rejects */}
      {(confirmed.length > 0 || rejected.length > 0) && (
        <Card title="Recent activity" subtitle={`${confirmed.length} confirmed · ${rejected.length} rejected (last 50)`}>
          <RecentList confirmed={confirmed} rejected={rejected} />
        </Card>
      )}
    </div>
  );
}

// ── Small UI helpers ─────────────────────────────────────────
function Stat({ label, value, sub, color }) {
  return (
    <div style={{ ...inn, padding: 12 }}>
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", color: C.dim, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <div style={crd}>
      <div style={{ padding: 22 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: C.bright, margin: "0 0 4px" }}>{title}</h3>
        {subtitle && <div style={{ fontSize: 11, color: C.dim, marginBottom: 14 }}>{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ ...inn, textAlign: "center", color: C.dim, fontSize: 12 }}>{children}</div>;
}

// ── Pending row ──────────────────────────────────────────────
function PendingRow({ entry, jobs, expanded, onExpand, onConfirmed, onRejected }) {
  const [vendorName, setVendorName] = useState(entry.vendorName || "");
  const [amount, setAmount] = useState(entry.amount || "");
  const [jobId, setJobId] = useState(entry.jobId || "");
  const [jobNumber, setJobNumber] = useState(entry.jobNumber || "");
  const [dueDate, setDueDate] = useState(entry.dueDate || "");
  const [scope, setScope] = useState(entry.scope || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Resolve job if a jobId was set on the entry
  const jobLabel = useMemo(() => {
    if (jobId && jobs) {
      const j = jobs.find((x) => x.id === jobId);
      if (j) return `${j.name} (#${j.number})`;
    }
    if (entry.jobNumber) return `Job #${entry.jobNumber}`;
    return "—";
  }, [jobId, entry.jobNumber, jobs]);

  const needsAmount = !entry.amount;
  const needsJob = !entry.jobNumber && !entry.jobId;

  const confirm = async () => {
    if (!amount || Number(amount) <= 0) { setErr("Amount required"); return; }
    setBusy(true);
    setErr(null);
    const body = {
      vendorName,
      amount: Number(amount),
      jobId: jobId || undefined,
      jobNumber: !jobId ? (jobNumber || undefined) : undefined,
      dueDate: dueDate || undefined,
      scope: scope || undefined,
    };
    const r = await api(`/api/ap/pending-bills/${entry.id}/confirm`, { method: "POST", body });
    setBusy(false);
    if (r.success) {
      onConfirmed();
    } else {
      setErr(r.error || "Confirm failed");
    }
  };

  const reject = async () => {
    const reason = window.prompt("Reason for rejection?", "Not needed");
    if (reason == null) return;
    setBusy(true);
    const r = await api(`/api/ap/pending-bills/${entry.id}/reject`, { method: "POST", body: { reason } });
    setBusy(false);
    if (r.success) onRejected();
    else setErr(r.error || "Reject failed");
  };

  return (
    <div style={{
      ...inn,
      borderColor: needsAmount ? "rgba(245,158,11,0.35)" : C.bdr,
      background: needsAmount ? "rgba(245,158,11,0.04)" : "rgba(255,255,255,0.03)",
    }}>
      <div onClick={onExpand} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.bright }}>{entry.vendorName || "(no vendor)"}</span>
            <span style={badge(entry.source === "docusign" ? "ok" : "warning")}>{entry.source}</span>
            {entry.releaseType && <span style={badge("ok")}>{entry.releaseType}</span>}
            {needsAmount && <span style={badge("warning")}>needs amount</span>}
            {needsJob && <span style={badge("warning")}>needs job</span>}
          </div>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.subject || entry.scope || "—"} {entry.invoiceNumber ? `· Invoice ${entry.invoiceNumber}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right", minWidth: 110 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: entry.amount ? C.bright : "#FDE68A", fontFamily: C.mono }}>
            {entry.amount ? fmt(entry.amount) : "—"}
          </div>
          <div style={{ fontSize: 9, color: C.dim }}>{jobLabel}</div>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.bdr}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Vendor"><input value={vendorName} onChange={(e) => setVendorName(e.target.value)} style={inputS} /></Field>
          <Field label="Gross Amount"><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputS} /></Field>
          <Field label="Job">
            <select value={jobId} onChange={(e) => setJobId(e.target.value)} style={inputS}>
              <option value="">(use job number)</option>
              {(jobs || []).filter((j) => !j.closedOn).map((j) => (
                <option key={j.id} value={j.id}>{j.name} (#{j.number})</option>
              ))}
            </select>
          </Field>
          <Field label="Job Number (fallback)">
            <input value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} disabled={!!jobId} style={{ ...inputS, opacity: jobId ? 0.5 : 1 }} />
          </Field>
          <Field label="Due Date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputS} />
          </Field>
          <Field label="Scope (description)">
            <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder={`Lien-release-driven bill — ${vendorName}`} style={inputS} />
          </Field>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            {err && <span style={{ fontSize: 10, color: "#FCA5A5", alignSelf: "center", marginRight: "auto" }}>{err}</span>}
            <button onClick={reject} disabled={busy} style={btnS(false)}>Reject</button>
            <button onClick={confirm} disabled={busy} style={btnS(true)}>
              {busy ? "Creating…" : "Confirm → Create JT Bill"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputS = {
  width: "100%",
  padding: "6px 10px",
  borderRadius: 6,
  background: "rgba(255,255,255,0.06)",
  border: `1px solid ${C.bdr}`,
  color: C.bright,
  fontSize: 12,
  fontFamily: "inherit",
};

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 9, color: C.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>
      {children}
    </div>
  );
}

// ── Open bills table ────────────────────────────────────────
function OpenBillsTable({ bills }) {
  const th = {
    fontSize: 9, fontWeight: 600, color: C.dim, textTransform: "uppercase",
    padding: "8px 8px", textAlign: "left", borderBottom: `1px solid ${C.bdr}`,
  };
  const td = { padding: "8px 8px", fontSize: 12, borderBottom: `1px solid rgba(255,255,255,0.04)`, color: C.text };

  return (
    <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${C.bdr}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Bill #</th>
            <th style={th}>Vendor</th>
            <th style={th}>Job</th>
            <th style={{ ...th, textAlign: "right" }}>Balance</th>
            <th style={th}>Due</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => {
            const dueColor =
              b.daysUntilDue == null ? C.dim :
              b.daysUntilDue < 0 ? "#FCA5A5" :
              b.daysUntilDue <= 3 ? "#FDE68A" :
              b.daysUntilDue <= 7 ? "#FBBF24" : C.text;
            return (
              <tr key={b.id}>
                <td style={td}>
                  <span style={{ fontFamily: C.mono, fontSize: 11, color: C.bright }}>{b.number}</span>
                  {b.pathA && <span style={{ ...badge("ok"), marginLeft: 6, fontSize: 8 }}>Path A</span>}
                </td>
                <td style={td}>{b.vendor?.name || "—"}</td>
                <td style={{ ...td, fontSize: 11 }}>
                  {b.job?.name || "—"}
                  {b.job?.number && <span style={{ color: C.dim, marginLeft: 4 }}>#{b.job.number}</span>}
                </td>
                <td style={{ ...td, textAlign: "right", fontFamily: C.mono, fontWeight: 600, color: C.bright }}>{fmt(b.balance)}</td>
                <td style={{ ...td, color: dueColor }}>
                  {b.dueDate || "—"}
                  {b.daysUntilDue != null && (
                    <span style={{ fontSize: 9, color: dueColor, marginLeft: 6 }}>
                      ({b.daysUntilDue < 0 ? `${-b.daysUntilDue}d overdue` : `${b.daysUntilDue}d`})
                    </span>
                  )}
                </td>
                <td style={td}><span style={badge(b.status)}>{b.status || "—"}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Manual + New Bill form (Phase 4) ─────────────────────────
function ManualBillForm({ jobs, onClose, onCreated }) {
  const [vendorName, setVendorName] = useState("");
  const [amount, setAmount] = useState("");
  const [jobId, setJobId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    if (!vendorName) { setErr("Vendor required"); return; }
    if (!amount || Number(amount) <= 0) { setErr("Amount required"); return; }
    if (!jobId) { setErr("Job required"); return; }
    setBusy(true);
    setErr(null);
    const body = {
      vendorName, amount: Number(amount), jobId,
      dueDate: dueDate || undefined,
      invoiceNumber: invoiceNumber || undefined,
      scope: scope || `Manual Path A bill — ${vendorName}`
    };
    // Manual goes into pending first (so it shows up with the rest of the
    // queue), then immediately confirm to create the JT bill. Two clicks of
    // overhead but keeps the audit trail consistent.
    const stage = await api("/api/ap/pending-bills/manual", { method: "POST", body });
    if (!stage.success) { setBusy(false); setErr(stage.error || "Stage failed"); return; }
    const id = stage.entry?.id || stage.existing?.id;
    if (!id) { setBusy(false); setErr("Stage returned no id"); return; }
    const conf = await api(`/api/ap/pending-bills/${id}/confirm`, { method: "POST", body });
    setBusy(false);
    if (conf.success) {
      onCreated();
    } else {
      setErr(conf.error || "Confirm failed");
    }
  };

  return (
    <div style={crd}>
      <div style={{ padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: C.bright, margin: 0 }}>+ New Bill (Manual Path A)</h3>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
              For invoices without lien releases — insurance auto-pay, software subscriptions, equipment retainers.
            </div>
          </div>
          <button onClick={onClose} style={btnS(false)}>Close</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Vendor"><input value={vendorName} onChange={(e) => setVendorName(e.target.value)} style={inputS} /></Field>
          <Field label="Amount"><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputS} /></Field>
          <Field label="Job">
            <select value={jobId} onChange={(e) => setJobId(e.target.value)} style={inputS}>
              <option value="">Select…</option>
              {(jobs || []).filter((j) => !j.closedOn).map((j) => (
                <option key={j.id} value={j.id}>{j.name} (#{j.number})</option>
              ))}
            </select>
          </Field>
          <Field label="Due Date"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputS} /></Field>
          <Field label="Invoice # (optional)"><input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} style={inputS} /></Field>
          <Field label="Description"><input value={scope} onChange={(e) => setScope(e.target.value)} placeholder={`Manual Path A bill — ${vendorName}`} style={inputS} /></Field>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          {err && <span style={{ fontSize: 11, color: "#FCA5A5", alignSelf: "center", marginRight: "auto" }}>{err}</span>}
          <button onClick={onClose} disabled={busy} style={btnS(false)}>Cancel</button>
          <button onClick={submit} disabled={busy} style={btnS(true)}>
            {busy ? "Creating…" : "Create JT Bill"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Recent confirmed/rejected list ───────────────────────────
function RecentList({ confirmed, rejected }) {
  const merged = [
    ...confirmed.map((c) => ({ ...c, kind: "confirmed", when: c.confirmedAt })),
    ...rejected.map((r) => ({ ...r, kind: "rejected", when: r.rejectedAt })),
  ].sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0)).slice(0, 20);

  if (merged.length === 0) return <Empty>No recent activity.</Empty>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {merged.map((m) => (
        <div key={m.id + "-" + m.kind} style={{ ...inn, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
            <span style={badge(m.kind === "confirmed" ? "good" : "critical")}>{m.kind}</span>
            <span style={{ color: C.bright, fontWeight: 600 }}>{m.vendorName}</span>
            {m.jtBillNumber && <span style={{ color: C.dim, fontFamily: C.mono }}>Bill {m.jtBillNumber}</span>}
            {m.reason && <span style={{ color: C.dim, fontStyle: "italic" }}>({m.reason})</span>}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontFamily: C.mono, color: C.text }}>{fmt(m.amount)}</span>
            <span style={{ color: C.dim, fontSize: 9 }}>{m.when ? new Date(m.when).toLocaleString() : ""}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
