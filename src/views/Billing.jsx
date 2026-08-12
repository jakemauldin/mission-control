import { useState, useEffect, useCallback, useMemo } from "react";
import { C, inn, crd } from "../lib/colors";
import { Section } from "../components/ui/Card";
import { btnS, badge, sv } from "../lib/helpers";

// ── Formatters ────────���──────────────────────────────────────
const fmt = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);
const fmtShort = (n) =>
  n >= 1000000 ? `$${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : fmt(n);
const fmtPct = (n) => `${Math.round((n || 0) * 10) / 10}%`;

// ── API helpers ──────────────────────────────────────────────
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

// ── Main Component ─────────────────���─────────────────────────
export default function BillingView({ jobs }) {
  const [selectedJobId, setSelectedJobId] = useState("");
  const [sov, setSov] = useState(null);        // schedule of values
  const [billing, setBilling] = useState(null); // billing state
  const [jobInfo, setJobInfo] = useState(null);
  const [activeApp, setActiveApp] = useState(null); // current app number
  const [lineItems, setLineItems] = useState({}); // working line items
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Load settings on mount
  useEffect(() => {
    api("/api/billing/settings").then((r) => r.ok && setSettings(r.data));
  }, []);

  // Load SOV when job selected
  const loadJob = useCallback(async (jobId) => {
    if (!jobId) return;
    setLoading(true);
    setActiveApp(null);
    setLineItems({});
    setSummary(null);

    const r = await api(`/api/billing/jobs/${jobId}/sov`);
    if (r.ok) {
      setSov(r.data.lines);
      setJobInfo(r.data.job);
      setBilling(r.data.billing);

      // If there's a draft app, open it
      const draft = r.data.billing?.applications?.find((a) => a.status === "draft");
      if (draft) {
        setActiveApp(draft.number);
        setLineItems(draft.lineItems || {});
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedJobId) loadJob(selectedJobId);
  }, [selectedJobId, loadJob]);

  // Get prior apps for previous totals
  const priorApps = useMemo(() => {
    if (!billing || !activeApp) return [];
    return billing.applications.filter((a) => a.number < activeApp && a.status === "final");
  }, [billing, activeApp]);

  // Calculate totals whenever lineItems change
  const rows = useMemo(() => {
    if (!sov) return [];
    const retPctWork = settings?.defaultRetainagePctWork ?? 10;
    const retPctMat = settings?.defaultRetainagePctMaterial ?? 10;

    return sov.map((line, idx) => {
      const sv = line.scheduledValue || 0;

      // Previous work from finalized apps
      let prevWork = 0, prevMat = 0;
      for (const pa of priorApps) {
        const pl = pa.lineItems?.[line.id];
        if (pl) {
          prevWork += pl.workThisPeriod || 0;
          prevMat += pl.materialsStored || 0;
        }
      }

      const cur = lineItems[line.id] || {};
      const work = cur.workThisPeriod || 0;
      const mat = cur.materialsStored || 0;
      const totalWork = prevWork + work;
      const total = totalWork + mat;
      const pct = sv > 0 ? (total / sv) * 100 : 0;
      const bal = Math.max(sv - total, 0);
      const rp = cur.retainagePct ?? retPctWork;
      const ret = totalWork * (rp / 100) + mat * ((cur.retainagePct ?? retPctMat) / 100);

      return {
        idx: idx + 1, id: line.id, groupName: line.groupName,
        description: line.description, isChangeOrder: line.isChangeOrder,
        scheduledValue: sv, prevWork, prevMat, work, mat,
        totalWork, total, pct: Math.min(pct, 100), bal, ret,
      };
    });
  }, [sov, lineItems, priorApps, settings]);

  // G702 summary
  const g702 = useMemo(() => {
    if (!rows.length) return null;
    const contract = rows.filter((r) => !r.isChangeOrder);
    const co = rows.filter((r) => r.isChangeOrder);
    const origSum = contract.reduce((s, r) => s + r.scheduledValue, 0);
    const netCO = co.reduce((s, r) => s + r.scheduledValue, 0);
    const contractSum = origSum + netCO;
    const totalCompleted = rows.reduce((s, r) => s + r.total, 0);
    const totalRet = rows.reduce((s, r) => s + r.ret, 0);
    const earnedLessRet = totalCompleted - totalRet;

    // Previous certificates
    let prevCerts = 0;
    if (priorApps.length > 0 && sov) {
      const retPctWork = settings?.defaultRetainagePctWork ?? 10;
      const retPctMat = settings?.defaultRetainagePctMaterial ?? 10;
      let priorTotal = 0, priorRet = 0;
      for (const line of sov) {
        let cumWork = 0, cumMat = 0;
        for (const pa of priorApps) {
          const pl = pa.lineItems?.[line.id];
          if (pl) { cumWork += pl.workThisPeriod || 0; cumMat += pl.materialsStored || 0; }
        }
        priorTotal += cumWork + cumMat;
        priorRet += cumWork * (retPctWork / 100) + cumMat * (retPctMat / 100);
      }
      prevCerts = priorTotal - priorRet;
    }

    const paymentDue = earnedLessRet - prevCerts;
    const balFinish = contractSum - totalCompleted;

    return { origSum, netCO, contractSum, totalCompleted, totalRet, earnedLessRet, prevCerts, paymentDue, balFinish };
  }, [rows, priorApps, sov, settings]);

  // ── Actions ──────��─────────────────────────────────────────
  const createNewApp = async () => {
    const r = await api(`/api/billing/jobs/${selectedJobId}/apps`, {
      method: "POST",
      body: { periodTo: new Date().toISOString().slice(0, 10), jobName: jobInfo?.name, jobNumber: jobInfo?.number },
    });
    if (r.ok) {
      await loadJob(selectedJobId);
      setActiveApp(r.data.number);
      setLineItems({});
    }
  };

  const saveApp = async () => {
    if (!activeApp) return;
    setSaving(true);
    await api(`/api/billing/jobs/${selectedJobId}/apps/${activeApp}`, {
      method: "PUT",
      body: { lineItems },
    });
    setSaving(false);
  };

  const finalizeApp = async () => {
    if (!activeApp) return;
    await saveApp();
    const r = await api(`/api/billing/jobs/${selectedJobId}/apps/${activeApp}/finalize`, { method: "POST" });
    if (r.ok) await loadJob(selectedJobId);
  };

  const downloadPdf = async (type) => {
    if (!activeApp) return;
    await saveApp();
    setPdfLoading(true);
    try {
      const res = await fetch(`/api/billing/jobs/${selectedJobId}/apps/${activeApp}/pdf/${type}`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type.toUpperCase()}-${jobInfo?.name || "Job"}-App${activeApp}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF download error:", err);
    }
    setPdfLoading(false);
  };

  // Update a single line item field
  const setLineField = (lineId, field, value) => {
    setLineItems((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], [field]: value },
    }));
  };

  // Quick % entry — set work this period based on target % complete
  const setByPercent = (lineId, targetPct) => {
    const row = rows.find((r) => r.id === lineId);
    if (!row) return;
    const targetTotal = row.scheduledValue * (targetPct / 100);
    const needed = Math.max(targetTotal - row.prevWork - row.prevMat, 0);
    const currentMat = lineItems[lineId]?.materialsStored || 0;
    setLineField(lineId, "workThisPeriod", Math.max(needed - currentMat, 0));
  };

  // ── Active application metadata ────────────────────────────
  const appMeta = billing?.applications?.find((a) => a.number === activeApp);
  const isFinalized = appMeta?.status === "final";

  // ── Render ─────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Job Selector + Settings */}
      <div style={crd}>
        <div style={{ padding: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: C.bright, margin: 0 }}>
              Commercial Billing — G702/G703
            </h2>
            <button onClick={() => setShowSettings(!showSettings)} style={btnS(false)}>
              Settings
            </button>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <select
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              style={{
                flex: 1, maxWidth: 400, padding: "8px 12px", borderRadius: 8,
                background: "rgba(255,255,255,0.06)", border: `1px solid ${C.bdr}`,
                color: C.bright, fontSize: 13, fontFamily: "inherit",
              }}
            >
              <option value="">Select a job...</option>
              {(jobs || []).filter((j) => !j.closedOn).map((j) => (
                <option key={j.id} value={j.id}>{j.name} (#{j.number})</option>
              ))}
              <optgroup label="Closed Jobs">
                {(jobs || []).filter((j) => j.closedOn).map((j) => (
                  <option key={j.id} value={j.id}>{j.name} (#{j.number})</option>
                ))}
              </optgroup>
            </select>

            {loading && <span style={{ fontSize: 11, color: C.dim }}>Loading...</span>}
          </div>

          {/* Settings panel */}
          {showSettings && settings && (
            <SettingsPanel settings={settings} setSettings={setSettings} onSave={async (s) => {
              await api("/api/billing/settings", { method: "PUT", body: s });
              setShowSettings(false);
            }} />
          )}
        </div>
      </div>

      {/* Application selector / creator */}
      {sov && (
        <div style={crd}>
          <div style={{ padding: "14px 22px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Applications:
            </span>
            {(billing?.applications || []).map((app) => (
              <button
                key={app.number}
                onClick={() => {
                  setActiveApp(app.number);
                  setLineItems(app.lineItems || {});
                }}
                style={{
                  ...btnS(activeApp === app.number),
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                #{app.number}
                <span style={{
                  ...badge(app.status === "final" ? "good" : "pending"),
                  fontSize: 8, padding: "1px 6px",
                }}>
                  {app.status}
                </span>
              </button>
            ))}
            <button onClick={createNewApp} style={{ ...btnS(true), fontSize: 11 }}>
              + New Application
            </button>
          </div>
        </div>
      )}

      {/* Main billing grid */}
      {activeApp && sov && (
        <>
          {/* Application header */}
          <div style={{ ...crd, padding: "14px 22px" }}>
            <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", fontWeight: 600 }}>Application</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>#{activeApp}</div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", fontWeight: 600 }}>Period To</div>
                <input
                  type="date"
                  value={appMeta?.periodTo || ""}
                  onChange={async (e) => {
                    await api(`/api/billing/jobs/${selectedJobId}/apps/${activeApp}`, {
                      method: "PATCH", body: { periodTo: e.target.value },
                    });
                    loadJob(selectedJobId);
                  }}
                  disabled={isFinalized}
                  style={{
                    background: "rgba(255,255,255,0.06)", border: `1px solid ${C.bdr}`,
                    color: C.bright, padding: "4px 8px", borderRadius: 6, fontSize: 13,
                    fontFamily: "inherit",
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", fontWeight: 600 }}>Status</div>
                <span style={badge(appMeta?.status === "final" ? "good" : "pending")}>
                  {appMeta?.status || "draft"}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", fontWeight: 600 }}>Project</div>
                <div style={{ fontSize: 13, color: C.bright, fontWeight: 600 }}>{jobInfo?.name}</div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                {!isFinalized && (
                  <>
                    <button onClick={saveApp} disabled={saving} style={btnS(false)}>
                      {saving ? "Saving..." : "Save Draft"}
                    </button>
                    <button onClick={finalizeApp} style={{ ...btnS(false), borderColor: "#2A9D8F", color: "#A7F3D0" }}>
                      Finalize
                    </button>
                  </>
                )}
                <button onClick={() => downloadPdf("g702")} disabled={pdfLoading} style={btnS(true)}>
                  {pdfLoading ? "..." : "G702 PDF"}
                </button>
                <button onClick={() => downloadPdf("g703")} disabled={pdfLoading} style={{ ...btnS(true), background: "#1a6b3c" }}>
                  {pdfLoading ? "..." : "G703 PDF"}
                </button>
              </div>
            </div>
          </div>

          {/* G702 Summary */}
          {g702 && <G702Summary data={g702} />}

          {/* SOV Grid */}
          <div style={crd}>
            <div style={{ padding: 22, overflowX: "auto" }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: C.bright, margin: "0 0 12px" }}>
                Schedule of Values — G703 Continuation Sheet
              </h3>
              <SOVTable
                rows={rows}
                lineItems={lineItems}
                setLineField={setLineField}
                setByPercent={setByPercent}
                disabled={isFinalized}
              />
            </div>
          </div>

          {/* Application history */}
          {billing?.applications?.length > 1 && (
            <AppHistory apps={billing.applications} activeApp={activeApp} />
          )}
        </>
      )}

      {/* Empty state */}
      {!selectedJobId && (
        <div style={{ ...crd, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.bright, marginBottom: 8 }}>G702/G703 Billing</div>
          <div style={{ fontSize: 13, color: C.dim, maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>
            Select a job above to start a payment application. The system pulls your schedule of values from JobTread,
            lets you enter progress for each line item, and generates AIA-standard G702 cover sheets and G703 continuation sheets.
          </div>
        </div>
      )}

      {selectedJobId && !sov && !loading && (
        <div style={{ ...inn, padding: 20, textAlign: "center", color: C.dim }}>
          No cost data found for this job. Make sure cost groups and cost items are set up in JobTread.
        </div>
      )}
    </div>
  );
}

// ── G702 Summary Panel ──────────────────���────────────────────
function G702Summary({ data }) {
  const lines = [
    { n: "1", label: "Original Contract Sum", val: data.origSum },
    { n: "2", label: "Net Change by Change Orders", val: data.netCO },
    { n: "3", label: "Contract Sum to Date", val: data.contractSum, bold: true, bg: "rgba(255,255,255,0.04)" },
    { n: "4", label: "Total Completed & Stored to Date", val: data.totalCompleted },
    { n: "5", label: "Total Retainage", val: data.totalRet },
    { n: "6", label: "Total Earned Less Retainage", val: data.earnedLessRet, bold: true, bg: "rgba(255,255,255,0.04)" },
    { n: "7", label: "Less Previous Certificates", val: data.prevCerts },
    { n: "8", label: "Current Payment Due", val: data.paymentDue, bold: true, accent: true },
    { n: "9", label: "Balance to Finish + Retainage", val: data.balFinish },
  ];

  const pctComplete = data.contractSum > 0 ? (data.totalCompleted / data.contractSum) * 100 : 0;

  return (
    <div style={crd}>
      <div style={{ padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: C.bright, margin: 0 }}>
            G702 — Application Summary
          </h3>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", fontWeight: 600 }}>Overall Progress</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#4A90D9" }}>{fmtPct(pctComplete)}</div>
            </div>
            <div style={{ width: 120, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(pctComplete, 100)}%`, height: "100%", borderRadius: 4, background: `linear-gradient(90deg, #4A90D9, #2A9D8F)`, transition: "width 0.3s" }} />
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {lines.map((l) => (
            <div
              key={l.n}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 12px", borderRadius: 8,
                background: l.accent ? "rgba(232,114,42,0.08)" : l.bg || "transparent",
                border: l.accent ? `1px solid rgba(232,114,42,0.25)` : "none",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.dim, width: 16 }}>{l.n}.</span>
                <span style={{ fontSize: 11, color: l.bold ? C.bright : C.text, fontWeight: l.bold ? 600 : 400 }}>{l.label}</span>
              </div>
              <span style={{
                fontSize: 13, fontWeight: l.bold ? 700 : 500, fontFamily: "'IBM Plex Mono', monospace",
                color: l.accent ? C.accent : l.bold ? C.bright : C.text,
              }}>
                {fmt(l.val)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── SOV Table ──────────────────���─────────────────────────────
function SOVTable({ rows, lineItems, setLineField, setByPercent, disabled }) {
  const [editingPct, setEditingPct] = useState(null);

  const thStyle = {
    fontSize: 9, fontWeight: 600, color: C.dim, textTransform: "uppercase",
    letterSpacing: "0.05em", padding: "8px 6px", textAlign: "right",
    borderBottom: `1px solid ${C.bdr}`, whiteSpace: "nowrap", position: "sticky", top: 0,
    background: C.card, zIndex: 1,
  };

  const thLeft = { ...thStyle, textAlign: "left" };

  const totalScheduled = rows.reduce((s, r) => s + r.scheduledValue, 0);
  const totalPrev = rows.reduce((s, r) => s + r.prevWork + r.prevMat, 0);
  const totalWork = rows.reduce((s, r) => s + r.work, 0);
  const totalMat = rows.reduce((s, r) => s + r.mat, 0);
  const totalCompleted = rows.reduce((s, r) => s + r.total, 0);
  const totalBal = rows.reduce((s, r) => s + r.bal, 0);
  const totalRet = rows.reduce((s, r) => s + r.ret, 0);

  let lastGroup = "";

  return (
    <div style={{ maxHeight: "60vh", overflow: "auto", borderRadius: 8, border: `1px solid ${C.bdr}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...thLeft, width: 30 }}>#</th>
            <th style={{ ...thLeft, minWidth: 180 }}>Description</th>
            <th style={{ ...thStyle, width: 95 }}>Scheduled Value</th>
            <th style={{ ...thStyle, width: 85 }}>Previous</th>
            <th style={{ ...thStyle, width: 110, color: "#A7F3D0" }}>This Period</th>
            <th style={{ ...thStyle, width: 90 }}>Materials</th>
            <th style={{ ...thStyle, width: 90 }}>Total</th>
            <th style={{ ...thStyle, width: 50 }}>%</th>
            <th style={{ ...thStyle, width: 90 }}>Balance</th>
            <th style={{ ...thStyle, width: 75 }}>Retainage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const showGroup = r.groupName && r.groupName !== lastGroup;
            if (showGroup) lastGroup = r.groupName;
            const isActive = r.work > 0 || r.mat > 0;

            return [
              showGroup && (
                <tr key={`g-${r.groupName}`}>
                  <td colSpan={10} style={{
                    padding: "6px 8px", fontSize: 10, fontWeight: 700,
                    color: r.isChangeOrder ? "#FDE68A" : "#93C5FD",
                    background: r.isChangeOrder ? "rgba(245,158,11,0.04)" : "rgba(74,144,217,0.04)",
                    borderBottom: `1px solid ${C.bdr}`,
                  }}>
                    {r.isChangeOrder ? "CO: " : ""}{r.groupName}
                  </td>
                </tr>
              ),
              <tr key={r.id} style={{
                background: isActive ? "rgba(42,157,143,0.03)" : "transparent",
                borderBottom: `1px solid rgba(255,255,255,0.04)`,
              }}>
                <td style={{ padding: "6px 8px", fontSize: 10, color: C.dim, textAlign: "center" }}>{r.idx}</td>
                <td style={{ padding: "6px 8px", fontSize: 11, color: C.bright, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.description}>
                  {r.description}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: C.text }}>
                  {fmt(r.scheduledValue)}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: C.dim }}>
                  {r.prevWork + r.prevMat > 0 ? fmt(r.prevWork + r.prevMat) : "—"}
                </td>
                <td style={{ padding: "4px 4px" }}>
                  <CurrencyInput
                    value={r.work}
                    onChange={(v) => setLineField(r.id, "workThisPeriod", v)}
                    disabled={disabled}
                    highlight
                  />
                </td>
                <td style={{ padding: "4px 4px" }}>
                  <CurrencyInput
                    value={r.mat}
                    onChange={(v) => setLineField(r.id, "materialsStored", v)}
                    disabled={disabled}
                  />
                </td>
                <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: isActive ? "#A7F3D0" : C.text }}>
                  {fmt(r.total)}
                </td>
                <td style={{ padding: "6px 4px", textAlign: "center" }}>
                  {editingPct === r.id && !disabled ? (
                    <input
                      type="number"
                      autoFocus
                      min={0} max={100} step={5}
                      style={{
                        width: 44, padding: "2px 4px", borderRadius: 4, textAlign: "center",
                        background: "rgba(74,144,217,0.15)", border: "1px solid rgba(74,144,217,0.4)",
                        color: "#93C5FD", fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
                      }}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) setByPercent(r.id, v);
                        setEditingPct(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                        if (e.key === "Escape") setEditingPct(null);
                      }}
                    />
                  ) : (
                    <span
                      onClick={() => !disabled && setEditingPct(r.id)}
                      style={{
                        fontSize: 10, cursor: disabled ? "default" : "pointer",
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: r.pct >= 100 ? "#2A9D8F" : r.pct > 0 ? "#4A90D9" : C.dim,
                        fontWeight: r.pct > 0 ? 600 : 400,
                      }}
                      title="Click to set % complete"
                    >
                      {fmtPct(r.pct)}
                    </span>
                  )}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 11, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: C.dim }}>
                  {fmt(r.bal)}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 10, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: C.dim }}>
                  {fmt(r.ret)}
                </td>
              </tr>,
            ];
          })}

          {/* Totals row */}
          <tr style={{ borderTop: `2px solid ${C.accent}`, background: "rgba(232,114,42,0.04)" }}>
            <td colSpan={2} style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, color: C.bright }}>TOTALS</td>
            <td style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: C.bright }}>{fmt(totalScheduled)}</td>
            <td style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: C.dim }}>{fmt(totalPrev)}</td>
            <td style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: "#A7F3D0" }}>{fmt(totalWork)}</td>
            <td style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: C.text }}>{fmt(totalMat)}</td>
            <td style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: C.bright }}>{fmt(totalCompleted)}</td>
            <td style={{ padding: "10px 8px", fontSize: 11, fontWeight: 700, textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", color: "#4A90D9" }}>
              {totalScheduled > 0 ? fmtPct((totalCompleted / totalScheduled) * 100) : "0%"}
            </td>
            <td style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: C.dim }}>{fmt(totalBal)}</td>
            <td style={{ padding: "10px 8px", fontSize: 11, fontWeight: 700, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", color: C.dim }}>{fmt(totalRet)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Currency Input ──────────────────���────────────────────────
function CurrencyInput({ value, onChange, disabled, highlight }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  if (editing && !disabled) {
    return (
      <input
        type="text"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseFloat(text.replace(/[,$]/g, ""));
          onChange(isNaN(v) ? 0 : Math.round(v * 100) / 100);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
          if (e.key === "Escape") { setEditing(false); }
        }}
        style={{
          width: "100%", padding: "3px 6px", borderRadius: 4, textAlign: "right",
          background: highlight ? "rgba(42,157,143,0.12)" : "rgba(255,255,255,0.08)",
          border: `1px solid ${highlight ? "rgba(42,157,143,0.4)" : "rgba(255,255,255,0.15)"}`,
          color: C.bright, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
          outline: "none",
        }}
      />
    );
  }

  return (
    <div
      onClick={() => {
        if (disabled) return;
        setText(value > 0 ? String(value) : "");
        setEditing(true);
      }}
      style={{
        padding: "3px 6px", borderRadius: 4, textAlign: "right",
        fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
        cursor: disabled ? "default" : "pointer",
        color: value > 0 ? (highlight ? "#A7F3D0" : C.bright) : C.dim,
        fontWeight: value > 0 ? 600 : 400,
        background: !disabled ? "rgba(255,255,255,0.02)" : "transparent",
        border: !disabled ? `1px solid transparent` : "none",
        transition: "all 0.15s",
        minHeight: 24,
      }}
      title={disabled ? "" : "Click to edit"}
    >
      {value > 0 ? fmt(value) : "—"}
    </div>
  );
}

// ── Settings Panel ─────────────────���─────────────────────────
function SettingsPanel({ settings, setSettings, onSave }) {
  const [local, setLocal] = useState(settings);

  const field = (path, label) => {
    const keys = path.split(".");
    const val = keys.reduce((o, k) => o?.[k], local) || "";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 10, color: C.dim, fontWeight: 600 }}>{label}</label>
        <input
          type={path.includes("Pct") ? "number" : "text"}
          value={val}
          onChange={(e) => {
            const newLocal = { ...local };
            let target = newLocal;
            for (let i = 0; i < keys.length - 1; i++) {
              target[keys[i]] = { ...target[keys[i]] };
              target = target[keys[i]];
            }
            target[keys[keys.length - 1]] = path.includes("Pct") ? parseFloat(e.target.value) || 0 : e.target.value;
            setLocal(newLocal);
          }}
          style={{
            padding: "6px 10px", borderRadius: 6,
            background: "rgba(255,255,255,0.06)", border: `1px solid ${C.bdr}`,
            color: C.bright, fontSize: 12, fontFamily: "inherit",
          }}
        />
      </div>
    );
  };

  return (
    <div style={{ ...inn, marginTop: 16 }}>
      <h4 style={{ fontSize: 12, fontWeight: 700, color: C.bright, margin: "0 0 12px" }}>Billing Settings</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {field("contractor.name", "Contractor Name")}
        {field("contractor.address", "Contractor Address")}
        {field("architect.name", "Architect Name")}
        {field("architect.address", "Architect Address")}
        {field("signatureName", "Signature Name")}
        {field("signatureTitle", "Signature Title")}
        {field("defaultRetainagePctWork", "Retainage % (Work)")}
        {field("defaultRetainagePctMaterial", "Retainage % (Material)")}
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button onClick={() => { setSettings(local); onSave(local); }} style={btnS(true)}>Save Settings</button>
        <button onClick={() => onSave(settings)} style={btnS(false)}>Cancel</button>
      </div>
    </div>
  );
}

// ── Application History ─────────────────���────────────────────
function AppHistory({ apps, activeApp }) {
  return (
    <div style={crd}>
      <div style={{ padding: 22 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: C.bright, margin: "0 0 12px" }}>Application History</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {apps.map((app) => {
            const isActive = app.number === activeApp;
            const st = sv(app.status === "final" ? "good" : app.status === "draft" ? "pending" : "ok");
            const totalWork = Object.values(app.lineItems || {}).reduce(
              (s, l) => s + (l.workThisPeriod || 0) + (l.materialsStored || 0), 0
            );

            return (
              <div key={app.number} style={{
                ...inn,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                borderColor: isActive ? C.accent : C.bdr,
              }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: isActive ? C.accent : C.bright }}>#{app.number}</span>
                  <span style={badge(app.status === "final" ? "good" : "pending")}>{app.status}</span>
                  <span style={{ fontSize: 11, color: C.dim }}>Period to {app.periodTo}</span>
                </div>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", color: C.text }}>
                    {fmt(totalWork)}
                  </span>
                  <span style={{ fontSize: 10, color: C.dim }}>
                    {app.createdAt ? new Date(app.createdAt).toLocaleDateString() : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
