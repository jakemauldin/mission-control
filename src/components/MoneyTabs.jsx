import { NavLink, Outlet } from "react-router-dom";
import { C, BRAND } from "../lib/colors";

// Sub-tabs for every /money/* route. Wraps the money routes in App.jsx so the
// money views themselves stay untouched.
const TABS = [
  { to: "/money/pay-apps", label: "Pay apps" },
  { to: "/money/bills", label: "Bills" },
  { to: "/money/sheet", label: "Bills sheet" },
];

export default function MoneyTabs() {
  return (
    <>
      <nav aria-label="Money sections" style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.border}`, overflowX: "auto", overflowY: "hidden" }}>
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} style={({ isActive }) => ({
            padding: "9px 14px", fontSize: 14, whiteSpace: "nowrap", textDecoration: "none", marginBottom: -1,
            fontWeight: isActive ? 700 : 500, color: isActive ? BRAND.focus : C.dim,
            borderBottom: `2px solid ${isActive ? BRAND.accent : "transparent"}`,
          })}>{t.label}</NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
