// Mission Control shell (DESIGN.md §1). react-router owns the URL. Primary nav is a
// top bar on desktop and a bottom tab bar on phone; everything else is behind the ⋯
// menu. Systems is also reached through the header status dot.
import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate, useSearchParams, useLocation } from "react-router-dom";
import { C, BRAND } from "./lib/colors";
import { useJobs, useHealth } from "./hooks/useLiveData";
import { useFavicon } from "./hooks/useFavicon";

import MoreMenu from "./components/MoreMenu";
import MoneyTabs from "./components/MoneyTabs";
import HeaderSlot from "./components/HeaderSlot";
import GlobalLayer from "./components/GlobalLayer";
import NavIcon from "./components/NavIcons";

import Brief from "./views/Brief";
import Login from "./views/Login";
import Media from "./views/Media";
import { RfiIndex, RfiJob } from "./views/RFIs";
import JobDetail from "./views/JobDetail";
import PostBuilder from "./views/PostBuilder";
import JobsView from "./views/Jobs";
import BillingView from "./views/Billing";
import OpenBillsView from "./views/OpenBills";
import ProjectsView from "./views/Projects";
import LandFinderView from "./views/LandFinder";
import SystemsView from "./views/Systems";
import SessionsView from "./views/Sessions";
import SkillsView from "./views/Skills";
import BillsSheetView from "./views/BillsSheet";
import ExpertiseView from "./views/Expertise";
import AccessView from "./views/Access";

function BriefRoute() {
  const [sp] = useSearchParams();
  return <Brief showAll={sp.get("all") === "1"} />;
}

// ONE nav config. `primary` shows in the desktop top nav and the phone bottom tab
// bar; `more` lives behind the ⋯ button. To move a page, move its line between the
// two arrays (decision f33d2e2c: RFIs keeps its own page; the rest is a best guess).
// `short` is the tab bar label, `icon` a key in NavIcons.
const NAV = {
  primary: [
    { to: "/", label: "Brief", short: "Brief", icon: "brief", end: true },
    { to: "/projects", label: "Projects", short: "Projects", icon: "projects" },
    { to: "/money/pay-apps", label: "Money", short: "Money", icon: "money", match: "/money" },
    { to: "/rfis", label: "RFIs", short: "RFIs", icon: "rfis" },
    { to: "/sessions", label: "Sessions", short: "Sessions", icon: "sessions" },
  ],
  more: [
    { to: "/jobs", label: "Jobs" },
    { to: "/media", label: "Media" },
    { to: "/media/post", label: "Post builder" },
    { to: "/systems", label: "Systems" },
    { to: "/skills", label: "Skills" },
    { to: "/access", label: "Access" },
    { to: "/land", label: "Land" },
    { to: "/expertise", label: "Expertise" },
  ],
};

// Money owns three routes under one tab strip (Pay apps / Bills / Bills sheet).
const isOn = (pathname, n) => { const base = n.match || n.to; return n.end ? pathname === base : pathname === base || pathname.startsWith(base + "/"); };

function Shell() {
  useFavicon();
  const jobsData = useJobs();
  const healthData = useHealth();
  const { pathname } = useLocation();

  // Status dot IS the Systems entry point (§1) — and it is LIVE, derived from the
  // outcomes endpoint, not the 01:00 health snapshot (Jake, 8/23: the stale RED
  // dot after the fixes was confusing). Polls every 60s.
  const [overall, setOverall] = useState(null);
  useEffect(() => {
    const load = () => fetch("/api/systems/outcomes").then(r => r.json()).then(d => setOverall(d.data?.overall)).catch(() => {});
    load(); const t = setInterval(load, 60000); return () => clearInterval(t);
  }, []);
  const dot = overall === "RED" ? "#D96C5C" : overall === "GREEN" ? "#7CB65C" : "#948D74";
  const dotText = overall === "RED" ? "Systems status: red. Something needs attention. Open Systems."
    : overall === "GREEN" ? "Systems status: green. Everything is running. Open Systems."
    : "Systems status: unknown. Open Systems.";

  const navStyle = ({ isActive }) => ({
    padding: "8px 14px", borderRadius: 8, fontSize: 14, textDecoration: "none", whiteSpace: "nowrap",
    fontWeight: isActive ? 700 : 500,
    color: isActive ? BRAND.focus : C.text,
    background: isActive ? C.card : "transparent",
    border: `1px solid ${isActive ? BRAND.border : "transparent"}`,
  });

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'IBM Plex Sans',-apple-system,sans-serif" }}>
      <div className="rc-shell" style={{ maxWidth: 1500, margin: "0 auto" }}>
        {/* One row at every width: dot, logo, (desktop nav), slot, ⋯ */}
        <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, minWidth: 0 }}>
          <NavLink to="/systems" title={dotText} aria-label={dotText} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, flex: "none", textDecoration: "none" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: dot, boxShadow: `0 0 8px ${dot}` }} />
          </NavLink>
          <NavLink to="/" aria-label="Brief" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", flex: "none" }}>
            <img src="/logo-64.png" alt="" style={{ width: 26, height: 26, borderRadius: 6 }} />
            <span className="hidden lg:block" style={{ fontWeight: 600, fontSize: 15, color: C.bright, fontFamily: "'Poppins',sans-serif", letterSpacing: 0.3 }}>RISING CREEK</span>
          </NavLink>
          <nav aria-label="Main" className="hidden md:flex" style={{ gap: 4, alignItems: "center", marginLeft: 8 }}>
            {NAV.primary.map(n => <NavLink key={n.to} to={n.to} end={n.end} style={() => navStyle({ isActive: isOn(pathname, n) })}>{n.label}</NavLink>)}
          </nav>
          <div style={{ flex: 1 }} />
          <div style={{ flex: "none", display: "flex", alignItems: "center" }}><HeaderSlot /></div>
          <MoreMenu items={NAV.more} />
        </header>

        <Routes>
          <Route path="/" element={<BriefRoute />} />
          <Route path="/jobs" element={<JobsView jobs={jobsData.jobs} live={jobsData.live} loading={jobsData.loading} />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/money" element={<MoneyTabs />}>
            <Route index element={<Navigate to="/money/pay-apps" replace />} />
            <Route path="pay-apps/*" element={<BillingView jobs={jobsData.jobs} />} />
            <Route path="bills" element={<OpenBillsView jobs={jobsData.jobs} />} />
            <Route path="sheet" element={<BillsSheetView />} />
            <Route path="personal" element={<Navigate to="/money/sheet" replace />} />
          </Route>
          <Route path="/rfis" element={<RfiIndex />} />
          <Route path="/rfis/:jobId" element={<RfiJob />} />
          <Route path="/media" element={<Media />} />
          <Route path="/media/post" element={<PostBuilder />} />
          <Route path="/systems" element={<SystemsWrap healthData={healthData} />} />
          <Route path="/projects" element={<ProjectsView />} />
          <Route path="/sessions" element={<SessionsView />} />
          <Route path="/skills" element={<SkillsView />} />
          <Route path="/land" element={<LandFinderView />} />
          <Route path="/expertise" element={<ExpertiseWrap />} />
          <Route path="/access" element={<AccessView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      {/* Phone bottom tab bar (<768px). The shell's bottom padding keeps content clear of it. */}
      <nav aria-label="Main" className="rc-tabbar" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40, gridTemplateColumns: `repeat(${NAV.primary.length}, 1fr)`, background: C.card, borderTop: `1px solid ${C.border}`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {NAV.primary.map(n => {
          const on = isOn(pathname, n);
          return (
            <NavLink key={n.to} to={n.to} aria-current={on ? "page" : undefined} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minHeight: 56, minWidth: 0, textDecoration: "none", fontSize: 11, fontWeight: on ? 700 : 500, color: on ? BRAND.focus : C.dim, borderTop: `2px solid ${on ? BRAND.accent : "transparent"}` }}>
              <NavIcon name={n.icon} />
              <span>{n.short}</span>
            </NavLink>
          );
        })}
      </nav>
      <GlobalLayer />
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
  const [tries, setTries] = useState(0);
  useEffect(() => {
    fetch("/api/projects").then(r => setAuthed(r.status !== 401)).catch(() => setAuthed("offline"));
  }, [tries]);
  if (authed === null) return null;
  // A failed probe is unknown, not logged in: offer a retry instead of a Shell full of errors.
  if (authed === "offline") return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 16, textAlign: "center" }}>
      <div>Can't reach Mission Control. Check your connection.</div>
      <button onClick={() => { setAuthed(null); setTries(t => t + 1); }} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 18px", cursor: "pointer", fontSize: 14 }}>Try again</button>
    </div>
  );
  return (
    <BrowserRouter>
      {authed
        ? <Routes><Route path="/login" element={<Navigate to="/" replace />} /><Route path="*" element={<Shell />} /></Routes>
        : <Routes><Route path="*" element={<Login />} /></Routes>}
    </BrowserRouter>
  );
}
