import { useState, useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { C, BRAND } from "../lib/colors";

// The ⋯ menu. Closes on outside click, Escape, Tab-away and route change; arrow
// keys move between items. `items` comes from the NAV config in App.jsx.
export default function MoreMenu({ items }) {
  // Open state is tied to the path it was opened on, so a route change closes it.
  const [openAt, setOpenAt] = useState(null);
  const wrap = useRef(null);
  const btn = useRef(null);
  const { pathname } = useLocation();
  const open = openAt === pathname;
  const setOpen = (v) => setOpenAt(v ? pathname : null);

  const active = items.some(n => pathname === n.to || pathname.startsWith(n.to + "/"));

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpenAt(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (open) wrap.current?.querySelector('[role="menuitem"]')?.focus();
  }, [open]);

  const onKey = (e) => {
    if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); btn.current?.focus(); return; }
    if (e.key === "Tab" && open) { setOpen(false); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    if (!open) { if (e.target === btn.current && e.key !== "Home" && e.key !== "End") { e.preventDefault(); setOpen(true); } return; }
    e.preventDefault();
    const els = [...wrap.current.querySelectorAll('[role="menuitem"]')];
    const i = els.indexOf(document.activeElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? els.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length;
    els[next]?.focus();
  };

  const itemStyle = { display: "block", width: "100%", textAlign: "left", padding: "10px 12px", color: C.text, textDecoration: "none", fontSize: 14, borderRadius: 6, background: "none", border: "none", cursor: "pointer" };

  return (
    <div ref={wrap} onKeyDown={onKey} style={{ position: "relative", flex: "none" }}>
      <button ref={btn} onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="More pages"
        style={{ background: open ? C.card : "none", border: `1px solid ${active || open ? BRAND.border : C.border}`, color: active ? BRAND.focus : C.dim, borderRadius: 8, minWidth: 40, height: 36, padding: "0 12px", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>⋯</button>
      {open && (
        <div role="menu" aria-label="More pages" style={{ position: "absolute", right: 0, top: 42, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 6, zIndex: 60, minWidth: 190, maxHeight: "calc(100vh - 140px)", overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
          {items.map(n => (
            <NavLink key={n.to} to={n.to} role="menuitem" style={({ isActive }) => ({ ...itemStyle, color: isActive ? BRAND.focus : C.text, fontWeight: isActive ? 700 : 400 })}>{n.label}</NavLink>
          ))}
          <div style={{ height: 1, background: C.border, margin: "6px 4px" }} />
          <button role="menuitem" onClick={() => fetch("/api/logout", { method: "POST" }).finally(() => { window.location.href = "/login"; })} style={{ ...itemStyle, color: C.dim }}>Sign out</button>
        </div>
      )}
    </div>
  );
}
