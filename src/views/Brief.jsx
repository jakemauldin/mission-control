// The Brief (DESIGN.md §2): tier-first action queue. One screen, top 6 rows, "+N more".
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { C, BRAND } from "../lib/colors";
import { Section } from "../components/ui/Card";

const TIER_LABEL = { 1: "SYSTEMS", 2: "BLOCKING", 3: "MONEY", 4: "RFI", 5: "MEDIA", 6: "DRIFT" };
const TIER_COLOR = { 1: "#f87171", 2: "#fb923c", 3: "#facc15", 4: "#fbbf24", 5: "#94a3b8", 6: "#64748b" };

function ageStr(ms) {
  if (!ms) return "";
  const d = Math.floor(ms / 86400000); if (d > 0) return `${d}d`;
  const h = Math.floor(ms / 3600000); if (h > 0) return `${h}h`;
  return `${Math.max(1, Math.floor(ms / 60000))}m`;
}

export default function Brief({ showAll }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/brief");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()).data); setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const snooze = async (key, days) => {
    const until = new Date(Date.now() + days * 86400000).toISOString();
    await fetch("/api/brief/snooze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, until }) });
    load();
  };

  if (err) return <Section title="Brief"><div style={{ color: C.dim }}>Brief unavailable: {err}</div></Section>;
  if (!data) return <Section title="Brief"><div style={{ color: C.dim }}>Loading…</div></Section>;
  const rows = showAll ? data.all : data.queue;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title={showAll ? `Everything (${rows.length})` : "Needs you"}>
        {rows.length === 0 && <div style={{ color: C.dim, padding: "12px 0" }}>Nothing needs you. Genuinely.</div>}
        {rows.map((r) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: TIER_COLOR[r.tier], width: 68, letterSpacing: 0.5 }}>{TIER_LABEL[r.tier]}</span>
            <span style={{ flex: 1, fontSize: 14 }}>{r.title}{r.snoozedTimes ? <em style={{ color: C.dim, fontSize: 11 }}> · snoozed {r.snoozedTimes}x</em> : null}</span>
            <span style={{ color: C.dim, fontSize: 12, width: 34, textAlign: "right" }}>{ageStr(r.age)}</span>
            <button onClick={() => snooze(r.key, 1)} title="Snooze 1 day" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 6, fontSize: 11, padding: "2px 7px", cursor: "pointer" }}>zz</button>
            <Link to={r.link} style={{ color: BRAND.link, fontSize: 13, textDecoration: "none", fontWeight: 600 }}>Open →</Link>
          </div>
        ))}
        {!showAll && data.more > 0 && (
          <Link to="/?all=1" style={{ display: "block", paddingTop: 10, color: C.dim, fontSize: 13, textDecoration: "none" }}>+{data.more} more</Link>
        )}
      </Section>
      {data.digest && (
        <Section title={`Overnight${data.digest.stale ? ` (from ${data.digest.date})` : ""}`}>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: C.text, fontFamily: "inherit", margin: 0 }}>{data.digest.text}</pre>
        </Section>
      )}
    </div>
  );
}
