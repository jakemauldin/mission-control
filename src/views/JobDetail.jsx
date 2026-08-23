// Job detail (DESIGN.md §1, route /jobs/:id): JT overview + RFI counts + pay-app state.
import { useState, useEffect, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { C, BRAND } from "../lib/colors";
import { useWebSocket } from "../hooks/useWebSocket";
import { Section } from "../components/ui/Card";

const RFI_ST = {
  blocking: { label: "blocking", color: "#f87171" },
  before_submittal: { label: "pre-submittal", color: "#fbbf24" },
  cleanup: { label: "cleanup", color: C.dim },
  closed: { label: "closed", color: "#4ade80" },
};

const PAYAPP_ST = {
  draft: { label: "draft", color: C.dim },
  finalized: { label: "finalized", color: "#4ade80" },
};

function money(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function JobDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [ok, setOk] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/jobs/${id}/detail`);
      if (r.status === 401) { setErr("session expired"); return; }
      const body = await r.json();
      setOk(body.ok !== false);
      setData(body.data || null);
      setErr(null);
    } catch (e) {
      setErr(String(e.message || e));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  const ws = useWebSocket();
  useEffect(() => {
    const t = ws.lastMessage?.type;
    if (t === "job_update" || t === "rfi_update" || t === "payapp_update") load();
  }, [ws.lastMessage, load]);

  if (err) return <Section title="Job"><div style={{ color: C.dim }}>{err}</div></Section>;
  if (!data) return <Section title="Job"><div style={{ color: C.dim }}>Loading…</div></Section>;

  const { jt, rfi, payApps } = data;
  const name = jt?.name || `Job ${id}`;
  const address = jt?.location?.address || jt?.address || null;
  const costItems = jt?.costItems?.nodes || jt?.costItems || null;
  const itemCount = Array.isArray(costItems) ? costItems.length : null;
  const total = Array.isArray(costItems)
    ? costItems.reduce((sum, it) => sum + (Number(it.totalCost ?? it.cost ?? it.total) || 0), 0)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Link to="/jobs" style={{ color: BRAND.link, fontSize: 13, textDecoration: "none" }}>← all jobs</Link>
        <h2 style={{ margin: "6px 0 2px", fontSize: 18, color: C.bright }}>{name}</h2>
        {address && <div style={{ color: C.dim, fontSize: 12 }}>{address}</div>}
      </div>

      <Section title="RFIs">
        {rfi ? (
          <Link to={`/rfis/${rfi.jobId}`} style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: C.text }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{rfi.title}</div>
              <div style={{ color: C.dim, fontSize: 12 }}>revised {rfi.revised || "?"}</div>
            </div>
            {rfi.counts?.blocking > 0 && (
              <span style={{ color: RFI_ST.blocking.color, fontSize: 12, fontWeight: 700 }}>{rfi.counts.blocking} blocking</span>
            )}
            {rfi.counts?.before_submittal > 0 && (
              <span style={{ color: RFI_ST.before_submittal.color, fontSize: 12 }}>{rfi.counts.before_submittal} pre-submittal</span>
            )}
            <span style={{ color: C.dim, fontSize: 12 }}>{rfi.counts?.closed || 0} closed</span>
          </Link>
        ) : (
          <div style={{ color: C.dim }}>No RFI log yet</div>
        )}
      </Section>

      <Section title="Pay applications">
        {payApps && payApps.length > 0 ? (
          payApps.map((p) => {
            const st = PAYAPP_ST[p.status] || { label: p.status || "?", color: C.dim };
            return (
              <Link key={p.number} to="/money/pay-apps" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.bdr}`, textDecoration: "none", color: C.text }}>
                <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Pay app #{p.number}</span>
                <span style={{ color: C.dim, fontSize: 12 }}>{p.periodTo || ""}</span>
                <span style={{ color: st.color, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>{st.label}</span>
              </Link>
            );
          })
        ) : (
          <div style={{ color: C.dim }}>None yet</div>
        )}
      </Section>

      <Section title="JobTread">
        {!ok && <div style={{ color: C.dim, marginBottom: 10 }}>JobTread unreachable</div>}
        {jt ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: C.text }}>
            <div>Name: {jt.name || "—"}</div>
            {address && <div>Address: {address}</div>}
            {itemCount != null && <div>Cost items: {itemCount}</div>}
            {total != null && <div>Cost total: {money(total)}</div>}
            <div style={{ color: C.dim, fontSize: 12, marginTop: 8 }}>JobTread is the system of record — figures here are a read-only snapshot.</div>
          </div>
        ) : (
          ok && <div style={{ color: C.dim }}>No data</div>
        )}
      </Section>
    </div>
  );
}
