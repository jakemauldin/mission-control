import { useState } from "react";
import { Link } from "react-router-dom";
import { C, BRAND, inn } from "../lib/colors";
import { Section } from "../components/ui/Card";
import { Row } from "../components/ui/Row";

export default function JobsView({ jobs, live, loading }) {
  // Closed jobs are noise, not signal (Jake, 8/23). Open by default; closed
  // behind a toggle — they still exist for closeout/retainage lookups.
  const [showClosed, setShowClosed] = useState(false);
  const open = (jobs || []).filter(j => !j.closedOn);
  const closed = (jobs || []).filter(j => j.closedOn);
  const shown = showClosed ? [...open, ...closed] : open;
  return (
    <Section title="Jobs — JobTread">
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: live ? "#2A9D8F" : "#64748B",
        }} />
        <span style={{ fontSize: 10, color: C.dim }}>
          {loading ? "Loading from JobTread..." : live ? `Live from JobTread — ${open.length} open` : "Not connected — check JOBTREAD_GRANT_KEY"}
        </span>
        {closed.length > 0 && (
          <button onClick={() => setShowClosed(v => !v)}
            style={{ marginLeft: "auto", background: "none", border: `1px solid ${C.border}`, color: showClosed ? BRAND.focus : C.dim, borderRadius: 6, fontSize: 11, padding: "3px 10px", cursor: "pointer" }}>
            {showClosed ? "hide" : "show"} {closed.length} closed
          </button>
        )}
      </div>

      {shown.length > 0 ? (
        <Row>
          {shown.map((j) => (
            <Link key={j.id} to={`/jobs/${j.id}`} style={{ ...inn, display: "block", textDecoration: "none", color: "inherit", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.bright }}>{j.name}</div>
                  <div className="mono" style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>#{j.number}</div>
                </div>
                <span style={{
                  fontSize: 10, padding: "3px 10px", borderRadius: 8, fontWeight: 600,
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
          ))}
        </Row>
      ) : (
        <div style={{ ...inn, textAlign: "center", padding: 32, color: C.dim, fontSize: 12 }}>
          {loading ? "Fetching jobs..." : "No job data available. Ensure the backend is running and JOBTREAD_GRANT_KEY is set in server/.env"}
        </div>
      )}
    </Section>
  );
}
