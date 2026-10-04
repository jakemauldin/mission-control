import { C, inn } from "../lib/colors";
import { Section } from "../components/ui/Card";
import Md from "../components/Md";

// Split on "## " headings only. Everything under a heading stays as one block of text,
// untouched: no colon splitting, no replace() with the text as a pattern, so "$1.2M: net 30"
// and similar lines come through exactly as written. "NAME — UPDATES October 4, 2026" is
// split into a name and a date for the card header.
function parseExpertise(md) {
  if (!md) return [];
  const sections = [];
  let cur = null;
  for (const line of String(md).split("\n")) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      if (cur) sections.push(cur);
      const t = h[1].trim();
      const m = /^(.*?)\s+[—–-]\s+UPDATES\s+(.+)$/i.exec(t);
      cur = { name: m ? m[1] : t, date: m ? m[2] : "", body: [] };
    } else if (cur) cur.body.push(line);
  }
  if (cur) sections.push(cur);
  return sections.map(s => ({ ...s, text: s.body.join("\n").trim() })).filter(s => s.text);
}

export default function ExpertiseView({ expertise }) {
  const sections = parseExpertise(expertise?.data);
  const isLive = expertise?.live;

  return (
    <Section title="Expertise notes">
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: isLive ? "#2A9D8F" : "#64748B" }} />
        <span style={{ fontSize: 11, color: C.dim }}>
          {isLive ? "Research notes from the OpenClaw workspace, newest first" : "Offline, can't reach OpenClaw"}
        </span>
      </div>

      {sections.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sections.map((s, i) => (
            <details key={i} open={i < 2} style={{ ...inn, padding: 0 }}>
              <summary style={{ cursor: "pointer", padding: "12px 14px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.bright, overflowWrap: "anywhere" }}>{s.name}</span>
                {s.date && <span style={{ fontSize: 11, color: C.dim }}>{s.date}</span>}
              </summary>
              <div style={{ padding: "0 14px 14px", fontSize: 13, color: C.text }}>
                <Md text={s.text} />
              </div>
            </details>
          ))}
        </div>
      ) : (
        <div style={{ ...inn, textAlign: "center", padding: 32, color: C.dim, fontSize: 12 }}>
          {expertise?.loading ? "Loading…" : "No notes yet."}
        </div>
      )}
    </Section>
  );
}
