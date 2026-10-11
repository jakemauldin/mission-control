// Tread Connection theme tokens: navy ground, blue accent, orange only for the one primary action.
// Moved off the Rising Creek olive/gold on 2026-10-10 (Jake: "tired of looking at olive green and yellow").
// Navy values match Tread Connection's own CSS (pacenotes/web/app.css: #242735 panel, #1b1d29 ground, #3a3e54 line).
// Olive stays on client documents and the risingcreek.ai site, not on dashboards.
export const C = {
  bg: "#1B1D29",        // navy ground
  card: "#242735",      // navy panel
  border: "#3A3E54",    // line
  bdr: "#3A3E54",       // alias of border: Systems, Projects, JobDetail, OpenBills and CommandBar read C.bdr
  text: "#D5D8E3",      // body
  dim: "#A3A8BC",       // secondary text
  bright: "#FFFFFF",    // headings
  accent: "#7AB2FF",    // blue accent
};

export const BRAND = {
  primary: "#1F5FBF",  // blue for light surfaces (client portal) only
  border: "#5F8FD8",   // borders + large text
  accent: "#7AB2FF",   // default accent (selected chips, active underline)
  link:   "#9CC4FF",   // links + emphasis
  focus:  "#B8D6FF",   // hover + focus + active nav text
};

// Orange is for the one primary action button per view and nothing else. Never a status, a link or a warning.
export const BTN = { bg: "#FF5600", fg: "#242735", edge: "#FF5600" };

// status colors (shared by sv() and views). Warn is amber, apart from the orange button and the blue accent.
export const STATUS = { good: "#6FD02F", warn: "#F0B34A", bad: "#FF8F85" };

export const crd = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 };
export const inn = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 };
