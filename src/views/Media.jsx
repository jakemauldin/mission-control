// Media workspace, phase 1 (DESIGN.md §3, amended): counts strip + open-gallery link.
// The design's iframe embed hits mixed-content (this app serves over Tailscale HTTPS,
// the gallery is plain http on the tailnet) — a top-level link works today; the native
// grid replaces this in phase 3 anyway.
import { useState, useEffect } from "react";
import { C, BRAND } from "../lib/colors";
import { Section } from "../components/ui/Card";

const GALLERY = "http://100.92.25.23:3251";

export default function Media() {
  const [counts, setCounts] = useState(null);
  useEffect(() => { fetch("/api/media/counts").then(r => r.json()).then(d => setCounts(d.data)).catch(() => {}); }, []);
  const cell = (label, n, hot) => (
    <div style={{ flex: 1, textAlign: "center", padding: "14px 6px", background: C.card, border: `1px solid ${hot ? BRAND.border : C.border}`, borderRadius: 10 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: hot ? BRAND.focus : C.bright }}>{n ?? "—"}</div>
      <div style={{ fontSize: 11, color: C.dim, marginTop: 2, letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {cell("AWAITING YOU", counts?.undecided, true)}
        {cell("AD WORTHY", counts?.approved)}
        {cell("POSTABLE", counts?.postable)}
        {cell("RECORDS", counts?.records)}
        {cell("TRASH", counts?.trash)}
      </div>
      <Section title="Grade & pick">
        <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.6 }}>
          The gallery is the working surface for grading — buckets, tags, undo, review queues. It opens over the tailnet.
        </p>
        <a href={GALLERY} target="_blank" rel="noreferrer"
          style={{ display: "inline-block", padding: "10px 18px", background: BRAND.accent, color: "#0C1017", borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
          Open the gallery →
        </a>
      </Section>
      <Section title="Generation">
        <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          Generation dispatch (Higgsfield, Fable-prompted) arrives in phase 2. Media lives on the rc-media volume; backed up to Spaces.
        </p>
      </Section>
    </div>
  );
}
