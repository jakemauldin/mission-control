// RFI workspace, phase 1 read-only (DESIGN.md §4). Reads rfi.json, never the markdown.
import { useState, useEffect } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { C, BRAND } from "../lib/colors";
import { Section } from "../components/ui/Card";

const ST = {
  blocking: { label: "BLOCKING", color: "#f87171" },
  before_submittal: { label: "BEFORE SUBMITTAL", color: "#fbbf24" },
  cleanup: { label: "CLEANUP", color: "#94a3b8" },
  closed: { label: "CLOSED", color: "#4ade80" },
};

export function RfiIndex() {
  const [jobs, setJobs] = useState(null);
  useEffect(() => { fetch("/api/rfis").then(r => r.json()).then(d => setJobs(d.data)).catch(() => setJobs([])); }, []);
  if (!jobs) return <Section title="RFIs"><div style={{ color: C.dim }}>Loading…</div></Section>;
  return (
    <Section title="RFIs by job">
      {jobs.length === 0 && <div style={{ color: C.dim }}>No job has an RFI log yet.</div>}
      {jobs.map(j => (
        <Link key={j.dir} to={`/rfis/${j.jobId}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.border}`, textDecoration: "none", color: C.text }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{j.job}</div>
            <div style={{ color: C.dim, fontSize: 12 }}>{j.title} · revised {j.revised || "?"}</div>
          </div>
          {j.counts.blocking > 0 && <span style={{ color: ST.blocking.color, fontSize: 12, fontWeight: 700 }}>{j.counts.blocking} blocking</span>}
          {j.counts.before_submittal > 0 && <span style={{ color: ST.before_submittal.color, fontSize: 12 }}>{j.counts.before_submittal} pre-submittal</span>}
          <span style={{ color: C.dim, fontSize: 12 }}>{j.counts.closed || 0} closed</span>
        </Link>
      ))}
    </Section>
  );
}

export function RfiJob() {
  const { jobId } = useParams();
  const { hash } = useLocation();
  const [rfi, setRfi] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    fetch(`/api/rfis/${jobId}`).then(async r => {
      if (!r.ok) throw new Error((await r.json()).error || r.status);
      setRfi((await r.json()).data);
    }).catch(e => setErr(String(e.message || e)));
  }, [jobId]);
  useEffect(() => {
    if (rfi && hash) setTimeout(() => document.querySelector(hash.replace("#", "#"))?.scrollIntoView({ block: "center" }), 100);
  }, [rfi, hash]);
  if (err) return <Section title="RFIs"><div style={{ color: C.dim }}>{err}</div></Section>;
  if (!rfi) return <Section title="RFIs"><div style={{ color: C.dim }}>Loading…</div></Section>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Link to="/rfis" style={{ color: BRAND.link, fontSize: 13, textDecoration: "none" }}>← all jobs</Link>
        <h2 style={{ margin: "6px 0 2px", fontSize: 18 }}>{rfi.job} — {rfi.title}</h2>
        <div style={{ color: C.dim, fontSize: 12 }}>{rfi.address} · issued by {rfi.issued_by} · revised {rfi.revised}</div>
      </div>
      {(rfi.groups || []).map(g => (
        <Section key={g.key} title={`${g.name}${g.contact ? " — " + g.contact : ""}`}>
          {(g.items || []).map(it => {
            const st = ST[it.status] || { label: it.status, color: C.dim };
            return (
              <div key={it.id} id={`item-${it.id}`} style={{ padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontFamily: "monospace", color: C.dim, fontSize: 12 }}>{it.id}</span>
                  <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{it.title}</span>
                  <span style={{ color: st.color, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>{st.label}</span>
                </div>
                {it.concern && <p style={{ margin: "6px 0 0", fontSize: 13, color: C.text, lineHeight: 1.5 }}>{it.concern}</p>}
                {it.ask && <p style={{ margin: "6px 0 0", fontSize: 13, color: BRAND.focus, lineHeight: 1.5 }}><b>Ask:</b> {it.ask}</p>}
                {it.update && <p style={{ margin: "6px 0 0", fontSize: 12, color: C.dim, lineHeight: 1.5 }}>Update: {it.update}</p>}
              </div>
            );
          })}
        </Section>
      ))}
    </div>
  );
}
