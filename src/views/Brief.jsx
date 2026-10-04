// The Brief (DESIGN.md §2): tier-first action queue. One screen, top 6 rows, "+N more".
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { C, BRAND, STATUS } from "../lib/colors";
import { useWebSocket } from "../hooks/useWebSocket";
import { Section } from "../components/ui/Card";

const TIER_LABEL = { 1: "SYSTEMS", 2: "NEEDS YOU", 3: "MONEY", 4: "RFI", 5: "MEDIA", 6: "FLAGGED" };
const TIER_COLOR = { 1: "#f87171", 2: "#fb923c", 3: "#facc15", 4: "#fbbf24", 5: "#94a3b8", 6: "#94a3b8" };

function ageStr(ms) {
  if (!ms) return "";
  const d = Math.floor(ms / 86400000); if (d > 0) return `${d}d`;
  const h = Math.floor(ms / 3600000); if (h > 0) return `${h}h`;
  return `${Math.max(1, Math.floor(ms / 60000))}m`;
}
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 0); return d; };
const SNOOZES = [["Today", () => endOfToday()], ["3 days", () => new Date(Date.now() + 3 * 86400000)], ["1 week", () => new Date(Date.now() + 7 * 86400000)]];

const btn = { background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 8, fontSize: 13, padding: "0 12px", minHeight: 36, cursor: "pointer" };

export default function Brief({ showAll }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [gone, setGone] = useState(() => new Set());   // rows removed optimistically until the next load lands
  const [menu, setMenu] = useState(null);              // key of the row whose snooze menu is open
  const [snoozed, setSnoozed] = useState(null);        // list when the "N snoozed" panel is open
  const [note, setNote] = useState(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/brief");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()).data); setErr(null); setGone(new Set());
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const ws = useWebSocket();
  useEffect(() => { if (ws.lastMessage?.type === "brief_update") load(); }, [ws.lastMessage, load]);

  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const hide = (key) => setGone((g) => new Set(g).add(key));
  const loadSnoozed = async () => {
    try { setSnoozed((await (await fetch("/api/brief/snoozed")).json()).data || []); } catch { setSnoozed([]); }
  };
  const snooze = async (key, until) => {
    setMenu(null); hide(key);
    await post("/api/brief/snooze", { key, until: until.toISOString() });
    await load(); if (snoozed) loadSnoozed();
  };
  const unsnooze = async (key) => { await post("/api/brief/unsnooze", { key }); await load(); loadSnoozed(); };
  const decide = async (row, action) => {
    hide(row.key); setNote(null);
    try {
      const r = await post(`/api/brief/needs/${encodeURIComponent(row.needId)}/decide`, { action });
      const j = await r.json();
      if (!j.ok) setNote(`Could not ${action} that item: ${j.error}`);
    } catch (e) { setNote(`Could not ${action} that item: ${e.message}`); }
    load();
  };

  if (err) return <Section title="Brief"><div style={{ color: C.dim }}>Brief unavailable: {err}</div></Section>;
  if (!data) return <Section title="Brief"><div style={{ color: C.dim }}>Loading…</div></Section>;
  const all = data.all.filter((r) => !gone.has(r.key));
  const rows = showAll ? all : all.slice(0, 6);
  const more = Math.max(0, all.length - rows.length);
  const cn = data.counts || {};
  const sys = data.systems || {};
  const sysLabel = sys.overall === "GREEN" ? "Systems green" : sys.overall === "RED" ? `Systems red, ${sys.red} card${sys.red === 1 ? "" : "s"}` : "Systems unknown";
  const sysColor = sys.overall === "GREEN" ? STATUS.good : sys.overall === "RED" ? STATUS.bad : C.dim;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const links = [["Needs you", cn.needs, "/?all=1"], ["Blocking RFIs", cn.blockingRfis, "/rfis"], ["Bills due", cn.billsDue, "/money/sheet"], ["Photos to grade", cn.photos, "/media"]];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", fontSize: 14 }}>
          <span style={{ color: C.bright, fontWeight: 600 }}>{today}</span>
          <Link to="/systems" style={{ color: C.text, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: sysColor }} />{sysLabel}
          </Link>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {links.map(([label, n, to]) => (
            <Link key={label} to={to} style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", color: C.text }}>
              {label}<b style={{ color: n ? BRAND.link : C.dim }}>{n ?? 0}</b>
            </Link>
          ))}
        </div>
        {data.chips?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {data.chips.map((c) => <span key={c.source} style={{ fontSize: 11, color: C.dim, border: `1px dashed ${C.border}`, borderRadius: 10, padding: "1px 8px" }}>{c.label}</span>)}
          </div>
        )}
      </div>

      <Section title={showAll ? `Everything (${all.length})` : "Needs you"}>
        {note && <div style={{ color: STATUS.bad, fontSize: 13, paddingBottom: 8 }}>{note}</div>}
        {rows.length === 0 && <div style={{ color: C.dim, padding: "12px 0" }}>Nothing needs you. Genuinely.</div>}
        {rows.map((r) => (
          <div key={r.key} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: TIER_COLOR[r.tier], width: 68, flexShrink: 0, letterSpacing: 0.5 }}>{TIER_LABEL[r.tier]}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, overflowWrap: "anywhere" }}>{r.title}{r.snoozedTimes ? <em style={{ color: C.dim, fontSize: 11 }}> · snoozed {r.snoozedTimes}x</em> : null}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6, paddingLeft: 78 }}>
              {ageStr(r.age) && <span style={{ color: C.dim, fontSize: 12, marginRight: 4 }}>{ageStr(r.age)} old</span>}
              {r.needId && (<>
                <button onClick={() => decide(r, "allow")} style={{ ...btn, color: STATUS.good, borderColor: STATUS.good }}>Allow</button>
                <button onClick={() => decide(r, "drop")} style={{ ...btn, color: STATUS.bad, borderColor: STATUS.bad }}>Drop</button>
              </>)}
              {menu === r.key
                ? SNOOZES.map(([label, at]) => <button key={label} onClick={() => snooze(r.key, at())} style={btn}>{label}</button>)
                : <button onClick={() => setMenu(r.key)} style={btn}>Snooze</button>}
              <Link to={r.link} style={{ color: BRAND.link, fontSize: 13, textDecoration: "none", fontWeight: 600, minHeight: 36, display: "inline-flex", alignItems: "center" }}>Open →</Link>
            </div>
          </div>
        ))}
        {!showAll && more > 0 && (
          <Link to="/?all=1" style={{ display: "block", paddingTop: 10, color: C.dim, fontSize: 13, textDecoration: "none" }}>+{more} more</Link>
        )}
        {data.snoozed > 0 && (
          <div style={{ paddingTop: 12 }}>
            <button onClick={() => (snoozed ? setSnoozed(null) : loadSnoozed())} style={btn}>{data.snoozed} snoozed{snoozed ? ", hide" : ""}</button>
            {snoozed && (
              <div style={{ marginTop: 8 }}>
                {snoozed.map((s) => (
                  <div key={s.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 13 }}>
                    <span style={{ flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>{s.title}<span style={{ color: C.dim }}> · back {new Date(s.until).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></span>
                    <button onClick={() => unsnooze(s.key)} style={btn}>Bring back</button>
                  </div>
                ))}
                {snoozed.length > 1 && <button onClick={() => unsnooze("*")} style={{ ...btn, marginTop: 6 }}>Bring all back</button>}
              </div>
            )}
          </div>
        )}
      </Section>
      {data.digest && (
        <Section title={`Overnight${data.digest.stale ? ` (from ${data.digest.date})` : ""}`}>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{data.digest.text}</div>
        </Section>
      )}
    </div>
  );
}
