import { C } from "./colors";

export const sv = (s) => {
  if (
    s === "critical" || s === "degraded" || s === "blocked" ||
    s === "expired" || s === "overdue" || s === "missing"
  )
    return {
      bg: "rgba(220,38,38,0.08)",
      bdr: "rgba(220,38,38,0.3)",
      txt: "#FCA5A5",
      dot: "#DC2626",
    };
  if (
    s === "high" || s === "warning" || s === "review" || s === "warn" ||
    s === "expiring" || s === "waiting" || s === "delayed" || s === "pending"
  )
    return {
      bg: "rgba(245,158,11,0.06)",
      bdr: "rgba(245,158,11,0.25)",
      txt: "#FDE68A",
      dot: "#F59E0B",
    };
  if (
    s === "good" || s === "healthy" || s === "active" || s === "ok" ||
    s === "current" || s === "on-track" || s === "matched" || s === "received"
  )
    return {
      bg: "rgba(42,157,143,0.06)",
      bdr: "rgba(42,157,143,0.25)",
      txt: "#A7F3D0",
      dot: "#2A9D8F",
    };
  return {
    bg: "rgba(255,255,255,0.03)",
    bdr: "rgba(255,255,255,0.1)",
    txt: "#D5D8E3",
    dot: "#64748B",
  };
};

export const btnS = (p) => ({
  fontSize: 11,
  padding: "5px 14px",
  borderRadius: 8,
  border: "none",
  background: p ? C.accent : "rgba(255,255,255,0.06)",
  color: p ? "#1B1D29" : C.text,
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: p ? 600 : 500,
});

export const badge = (s) => {
  const st = sv(s);
  return {
    fontSize: 10,
    padding: "3px 10px",
    borderRadius: 8,
    background: st.bg,
    border: `1px solid ${st.bdr}`,
    color: st.txt,
    fontWeight: 600,
    textTransform: "capitalize",
    whiteSpace: "nowrap",
  };
};
