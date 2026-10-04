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

  const { jt, rfi, payApps, customer } = data;
  // The URL can carry Jake's job number; pay-app links need the real JT id.
  const jtId = data.jtId || jt?.id || id;
  const name = jt?.name || `Job ${id}`;
  const address = jt?.location?.address || jt?.address || null;
  const costItems = jt?.costItems?.nodes || jt?.costItems || null;
  const itemCount = Array.isArray(costItems) ? costItems.length : null;
  // A failed lookup comes back as {ok:false,error}, not null.
  const found = !!(jt && jt.id);
  const status = jt?.closedOn ? `Closed ${new Date(jt.closedOn).toLocaleDateString()}` : "Open";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Link to="/jobs" style={{ color: BRAND.link, fontSize: 13, textDecoration: "none" }}>← all jobs</Link>
        <h2 style={{ margin: "6px 0 2px", fontSize: 18, color: C.bright }}>{name}</h2>
        <div style={{ color: C.dim, fontSize: 12 }}>
          {found ? `${jt.number ? `#${jt.number}` : ""}${customer ? ` · ${customer}` : ""} · ${status}` : "Job not found"}
        </div>
        {address && <div style={{ color: C.dim, fontSize: 12 }}>{address}</div>}
      </div>

      <Section title="RFIs">
        {rfi ? (
          <Link to={`/rfis/${rfi.jobId}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", textDecoration: "none", color: C.text }}>
            <div style={{ flex: "1 1 200px" }}>
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
          <div style={{ color: C.dim }}>No RFI log for this job yet.</div>
        )}
      </Section>

      <Section title="Pay applications">
        {payApps && payApps.length > 0 ? (
          payApps.map((p) => {
            const st = PAYAPP_ST[p.status] || { label: p.status || "?", color: C.dim };
            return (
              <Link key={p.number} to={`/money/pay-apps/${jtId}/${p.number}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.border}`, textDecoration: "none", color: C.text }}>
                <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Pay app #{p.number}</span>
                <span style={{ color: C.dim, fontSize: 12 }}>{p.periodTo || ""}</span>
                <span style={{ color: st.color, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>{st.label}</span>
              </Link>
            );
          })
        ) : (
          <div style={{ color: C.dim }}>None yet.{found && <> <Link to={`/money/pay-apps/${jtId}`} style={{ color: BRAND.link }}>Start one</Link></>}</div>
        )}
      </Section>

      <Section title="JobTread">
        {!ok && found && <div style={{ color: C.dim, marginBottom: 10 }}>JobTread unreachable</div>}
        {found ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: C.text }}>
            <div>Name: {jt.name || "—"}</div>
            {customer && <div>Customer: {customer}</div>}
            {address && <div>Address: {address}</div>}
            {itemCount != null && <div>Cost items: {itemCount}</div>}
            <a href={`https://app.jobtread.com/jobs/${jtId}`} target="_blank" rel="noreferrer" style={{ color: BRAND.link }}>Open in JobTread</a>
            <div style={{ color: C.dim, fontSize: 12, marginTop: 8 }}>JobTread is the system of record. This page is a read-only snapshot.</div>
          </div>
        ) : (
          <div style={{ color: C.dim }}>Job not found in JobTread.</div>
        )}
      </Section>
    </div>
  );
}
