// Rising Creek theme tokens. Values derive from rc-brand-config.json
// (#635500 dark olive/gold is THE brand color; Poppins headings, Open Sans body).
// Dark surfaces use warm near-blacks so the olive family reads as Rising Creek,
// not as a generic slate dashboard. #635500 itself fails contrast on dark
// (2.57:1) so accents come from the derived ramp below (DESIGN.md §8).
export const C = {
  bg: "#0E0C06",        // warm near-black
  card: "#181509",      // warm card
  border: "#2E2915",    // olive-tinged border
  text: "#DDD8C6",      // warm off-white body
  dim: "#948D74",       // warm slate
  bright: "#F4EFDE",    // headings
  accent: "#A8952B",    // brand accent (was Divi orange — retired)
};

export const BRAND = {
  primary: "#635500",  // the true brand color — light surfaces (client portal) only
  border: "#8A7A12",   // 4.42:1 on card — borders + large text
  accent: "#A8952B",   // 6.35:1 — default accent
  link:   "#C2AC3D",   // 8.4:1 — links + emphasis
  focus:  "#D6C255",   // 10.6:1 — hover + focus
};

// status colors (shared by sv() and views)
export const STATUS = { good: "#7CB65C", warn: "#D9A93B", bad: "#D96C5C" };

export const crd = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 };
export const inn = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 };
