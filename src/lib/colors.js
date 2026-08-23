export const C = {
  bg: "#030712",
  card: "#0C1017",
  bdr: "#1C2030",
  text: "#CBD5E1",
  dim: "#64748B",
  bright: "#F1F5F9",
  accent: "#E8722A",
  font: "'IBM Plex Sans', -apple-system, sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

export const crd = {
  background: C.card,
  border: `1px solid ${C.bdr}`,
  borderRadius: 16,
};

export const inn = {
  background: "rgba(255,255,255,0.03)",
  border: `1px solid ${C.bdr}`,
  borderRadius: 12,
  padding: 14,
};

// Rising Creek dark-surface ramp derived from rc-brand-config.json's #635500 anchor
// (which fails contrast on dark cards at 2.57:1 — DESIGN.md §8). New surfaces use
// these; existing views keep their inline styles until touched for another reason.
export const BRAND = {
  border: "#8A7A12",   // 4.42:1 — borders + large text only
  accent: "#A8952B",   // 6.35:1 — default accent
  link:   "#C2AC3D",   // 8.4:1  — links + emphasis
  focus:  "#D6C255",   // 10.6:1 — hover + focus ring
};
