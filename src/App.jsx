// Mission Control shell (DESIGN.md §1). react-router owns the URL; the old flat
// view-string switch and the 600ms agent simulation are gone. Five nav items:
// Brief, Money, Media, RFIs, Jobs. Systems is reached through the header status
// dot; Projects and Land live in the overflow menu.
import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate, useSearchParams } from "react-router-dom";
import { C, BRAND } from "./lib/colors";
import { useJobs, useHealth } from "./hooks/useLiveData";

import Brief from "./views/Brief";
import Login from "./views/Login";
import Media from "./views/Media";
import { RfiIndex, RfiJob } from "./views/RFIs";
import JobsView from "./views/Jobs";
import BillingView from "./views/Billing";
import OpenBillsView from "./views/OpenBills";
import ProjectsView from "./views/Projects";
import LandFinderView from "./views/LandFinder";
import SystemsView from "./views/Systems";
import ExpertiseView from "./views/Expertise";

function BriefRoute() {
  const [sp] = useSearchParams();
  return <Brief showAll={sp.get("all") === "1"} />;
}

const NAV = [
  { to: "/", label: "Brief", end: true },
  { to: "/money/pay-apps", label: "Money" },
  { to: "/media", label: "Media" },
  { to: "/rfis", label: "RFIs" },
  { to: "/jobs", label: "Jobs" },
];

function Shell() {
  const jobsData = useJobs();
  const healthData = useHealth();
  const [menu, setMenu] = useState(false);

  // Status dot IS the Systems entry point (§1).
  const healthText = typeof healthData.data === "string" ? healthData.data : "";
  const red = /STATUS:\s*RED/i.test(healthText);
  const yellow = /STATUS:\s*YELLOW/i.test(healthText);
  const dot = red ? "#f87171" : yellow ? "#facc15" : "#4ade80";

  const navStyle = ({ isActive }) => ({
    padding: "8px 14px", borderRadius: 8, fontSize: 14, textDecoration: "none",
    fontWeight: isActive ? 700 : 500,
    color: isActive ? BRAND.focus : C.text,
    background: isActive ? C.card : "transparent",
    border: `1px solid ${isActive ? BRAND.border : "transparent"}`,
  });

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'IBM Plex Sans',-apple-system,sans-serif" }}>
      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "16px 18px" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <NavLink to="/systems" title="Systems" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: dot, boxShadow: `0 0 8px ${dot}` }} />
          </NavLink>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.bright, marginRight: 8 }}>Rising Creek</div>
          <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
            {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end} style={navStyle}>{n.label}</NavLink>)}
          </nav>
          <div style={{ position: "relative" }}>
            <button onClick={() => setMenu(m => !m)} style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>⋯</button>
            {menu && (
              <div onClick={() => setMenu(false)} style={{ position: "absolute", right: 0, top: 38, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 6, zIndex: 50, minWidth: 150 }}>
                {[["/projects", "Projects"], ["/land", "Land"], ["/money/bills", "Bills"], ["/systems", "Systems"], ["/expertise", "Expertise"]].map(([to, label]) => (
                  <NavLink key={to} to={to} style={{ display: "block", padding: "8px 12px", color: C.text, textDecoration: "none", fontSize: 13, borderRadius: 6 }}>{label}</NavLink>
                ))}
                <button onClick={() => fetch("/api/logout", { method: "POST" }).then(() => window.location.href = "/login")}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", color: C.dim, fontSize: 13, cursor: "pointer" }}>Sign out</button>
              </div>
            )}
          </div>
        </header>

        <Routes>
          <Route path="/" element={<BriefRoute />} />
          <Route path="/jobs" element={<JobsView jobs={jobsData.jobs} live={jobsData.live} loading={jobsData.loading} />} />
          <Route path="/money" element={<Navigate to="/money/pay-apps" replace />} />
          <Route path="/money/pay-apps/*" element={<BillingView jobs={jobsData.jobs} />} />
          <Route path="/money/bills" element={<OpenBillsView jobs={jobsData.jobs} />} />
          <Route path="/rfis" element={<RfiIndex />} />
          <Route path="/rfis/:jobId" element={<RfiJob />} />
          <Route path="/media" element={<Media />} />
          <Route path="/systems" element={<SystemsWrap healthData={healthData} />} />
          <Route path="/projects" element={<ProjectsView />} />
          <Route path="/land" element={<LandFinderView />} />
          <Route path="/expertise" element={<ExpertiseWrap />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

// Legacy view adapters — keep their internals untouched (DESIGN.md §9).
function SystemsWrap({ healthData }) {
  return <SystemsView crons={[]} handleRunCron={() => {}} healthData={healthData} cronsLive={false} />;
}
function ExpertiseWrap() {
  const [exp, setExp] = useState({ live: false, data: null });
  useEffect(() => { fetch("/api/expertise").then(r => r.json()).then(d => setExp({ live: d.ok, data: d.data })).catch(() => {}); }, []);
  return <ExpertiseView expertise={exp} />;
}

export default function App() {
  // Auth gate: one probe against a real authed endpoint decides Login vs Shell.
  const [authed, setAuthed] = useState(null);
  useEffect(() => {
    fetch("/api/projects").then(r => setAuthed(r.status !== 401)).catch(() => setAuthed(true));
  }, []);
  if (authed === null) return null;
  return (
    <BrowserRouter>
      {authed
        ? <Routes><Route path="/login" element={<Navigate to="/" replace />} /><Route path="*" element={<Shell />} /></Routes>
        : <Routes><Route path="*" element={<Login />} /></Routes>}
    </BrowserRouter>
  );
}
