import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { C, BRAND, inn } from "../lib/colors";
import { Section } from "../components/ui/Card";
import { Row } from "../components/ui/Row";

// Job numbers are strings ("119", sometimes "—"); sort numerically, highest first.
const byNumberDesc = (a, b) => (parseInt(b.number, 10) || 0) - (parseInt(a.number, 10) || 0);

function JobCard({ j }) {
  const customer = j._raw?.customer;
  return (
    <Link to={`/jobs/${j.id}`} style={{ ...inn, display: "block", textDecoration: "none", color: "inherit", cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.bright }}>{j.name}</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
            <span className="mono">#{j.number}</span>{customer ? ` · ${customer}` : ""}
          </div>
        </div>
        <span style={{
          fontSize: 10, padding: "3px 10px", borderRadius: 8, fontWeight: 600, flexShrink: 0,
          background: j.closedOn ? "rgba(42,157,143,0.08)" : "rgba(74,144,217,0.08)",
          border: `1px solid ${j.closedOn ? "rgba(42,157,143,0.25)" : "rgba(74,144,217,0.25)"}`,
          color: j.closedOn ? "#A7F3D0" : "#93C5FD",
        }}>
          {j.closedOn ? "Closed" : "Open"}
        </span>
      </div>
      {j.description && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "#94A3B8", lineHeight: 1.5 }}>{j.description}</p>
      )}
      <div style={{ marginTop: 6, fontSize: 9, color: C.dim }}>
        {j.closedOn ? `Closed ${new Date(j.closedOn).toLocaleDateString()}` : `Created ${new Date(j.createdAt).toLocaleDateString()}`}
      </div>
    </Link>
  );
}

export default function JobsView({ jobs, live, loading }) {
  // Open jobs first, newest number on top. Closed jobs stay collapsed (Jake, 8/23)
  // but are still searchable and reachable for closeout/retainage lookups.
  const [showClosed, setShowClosed] = useState(false);
  const [q, setQ] = useState("");
  const { open, closed } = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (j) => !term || `${j.number} ${j.name} ${j._raw?.customer || ""}`.toLowerCase().includes(term);
    const all = (jobs || []).filter(match);
    return {
      open: all.filter(j => !j.closedOn).sort(byNumberDesc),
      closed: all.filter(j => j.closedOn).sort(byNumberDesc),
    };
  }, [jobs, q]);
  // A search that only hits closed jobs should show them without another click.
  const closedVisible = showClosed || (q.trim() !== "" && open.length === 0);
  const total = (jobs || []).length;
  return (
    <Section title="Jobs — JobTread">
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: live ? "#2A9D8F" : "#64748B",
        }} />
        <span style={{ fontSize: 11, color: C.dim }}>
          {loading ? "Loading from JobTread..." : live ? `${total} jobs from JobTread, ${(jobs || []).filter(j => !j.closedOn).length} open` : "Not connected — check JOBTREAD_GRANT_KEY"}
        </span>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by number, name or customer"
        aria-label="Search jobs"
        style={{ width: "100%", boxSizing: "border-box", marginBottom: 12, padding: "9px 12px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, color: C.bright, fontSize: 14, fontFamily: "inherit" }}
      />

      {open.length > 0 && <Row>{open.map((j) => <JobCard key={j.id} j={j} />)}</Row>}
      {open.length === 0 && !loading && total > 0 && closed.length === 0 && (
        <div style={{ ...inn, textAlign: "center", padding: 24, color: C.dim, fontSize: 12 }}>No jobs match "{q}".</div>
      )}

      {closed.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setShowClosed(v => !v)} aria-expanded={closedVisible}
            style={{ background: "none", border: `1px solid ${C.border}`, color: closedVisible ? BRAND.focus : C.dim, borderRadius: 6, fontSize: 12, padding: "6px 12px", cursor: "pointer", marginBottom: 10 }}>
            {closedVisible ? "Hide" : "Show"} {closed.length} closed jobs
          </button>
          {closedVisible && <Row>{closed.map((j) => <JobCard key={j.id} j={j} />)}</Row>}
        </div>
      )}

      {total === 0 && (
        <div style={{ ...inn, textAlign: "center", padding: 32, color: C.dim, fontSize: 12 }}>
          {loading ? "Fetching jobs..." : "No job data available. Ensure the backend is running and JOBTREAD_GRANT_KEY is set in server/.env"}
        </div>
      )}
    </Section>
  );
}
