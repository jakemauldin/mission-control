import { useState, useEffect, useCallback } from "react";
import { C } from "./lib/colors";
import { STATIONS, AGENTS_INIT } from "./lib/seed-data";
import { useJobs, useCrons, useHealth, useClawStatus, useInsights, useExpertise, useIntelligence } from "./hooks/useLiveData";
import { useWebSocket } from "./hooks/useWebSocket";

import Header from "./components/Header";
import DetailPanel from "./components/DetailPanel";
import Timeline from "./components/Timeline";

import SitePlan from "./views/SitePlan";
import SystemsView from "./views/Systems";
import JobsView from "./views/Jobs";
import CrewView from "./views/Crew";
import CostsView from "./views/Costs";
import IntelligenceView from "./views/Intelligence";
import ExpertiseView from "./views/Expertise";
import RoadmapView from "./views/Roadmap";
import BillingView from "./views/Billing";
import OpenBillsView from "./views/OpenBills";
import LandFinderView from "./views/LandFinder";

export default function App() {
  const [view, setView] = useState("site");
  const [agents] = useState(AGENTS_INIT);
  const [pos, setPos] = useState({});
  const [selAgent, setSelAgent] = useState(AGENTS_INIT[0]);
  const [buildProg, setBuildProg] = useState(52);
  const [timeline, setTimeline] = useState([]);
  const [time, setTime] = useState(new Date());
  const [paused, setPaused] = useState(false);

  // ── Live data hooks ──────────────────────────────────────
  const jobsData = useJobs();
  const cronsData = useCrons();
  const healthData = useHealth();
  const clawStatus = useClawStatus();
  const insights = useInsights();
  const expertise = useExpertise();
  const intelligence = useIntelligence();
  const ws = useWebSocket();

  // ── WebSocket → timeline push ────────────────────────────
  useEffect(() => {
    if (!ws.lastMessage) return;
    const msg = ws.lastMessage;
    if (msg.type === "claw_update" || msg.type === "health_update") {
      addTL(`[Live] ${msg.type.replace("_", " ")} received`, "info");
    }
  }, [ws.lastMessage]);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Initialize agent positions
  useEffect(() => {
    const p = {};
    AGENTS_INIT.forEach((a) => {
      const st = STATIONS.find((s) => s.id === a.home);
      if (st) {
        const ox = (Math.random() - 0.5) * 6;
        p[a.id] = { x: st.x + ox, y: st.y + Math.random() * 2 - 1, tx: null, ty: null, facing: ox > 0 ? "right" : "left", station: a.home, pi: 0 };
      }
    });
    setPos(p);
  }, []);

  // Agent movement simulation
  useEffect(() => {
    if (paused) return;
    const iv = setInterval(() => {
      setBuildProg((p) => Math.min(100, p + AGENTS_INIT.filter((a) => a.status === "active").length * 0.012));
      setPos((prev) => {
        const next = { ...prev };
        AGENTS_INIT.forEach((a) => {
          const p = next[a.id];
          if (!p) return;
          if (p.tx === null && Math.random() < 0.02) {
            const ni = (p.pi + 1) % a.patrol.length;
            const destId = a.patrol[ni];
            const dest = STATIONS.find((s) => s.id === destId);
            if (dest) {
              const tx = dest.x + (Math.random() - 0.5) * 6;
              next[a.id] = { ...p, tx, ty: dest.y + Math.random() * 2 - 1, facing: tx > p.x ? "right" : "left", station: destId, pi: ni };
            }
          }
          if (p.tx !== null) {
            const dx = p.tx - p.x;
            const dy = p.ty - p.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < 0.3) next[a.id] = { ...p, x: p.tx, y: p.ty, tx: null, ty: null };
            else next[a.id] = { ...p, x: p.x + (dx / d) * 0.25, y: p.y + (dy / d) * 0.25, facing: dx > 0 ? "right" : "left" };
          }
        });
        return next;
      });
    }, 600);
    return () => clearInterval(iv);
  }, [paused]);

  const addTL = useCallback((msg, type = "action") => {
    setTimeline((prev) => [
      { t: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }), msg, type },
      ...prev.slice(0, 49),
    ]);
  }, []);

  const handleDispatch = (cmd) => {
    if (typeof cmd === "string" && cmd.trim()) {
      addTL(`Dispatched: "${cmd}"`);
    }
  };

  const handleRunCron = (id) => {
    const c = cronsData.crons?.find((c) => c.id === id);
    addTL(`Running: ${c?.name || id}`);
  };

  // Count live sources for header
  const liveCount = [jobsData.live, cronsData.live, healthData.live, clawStatus.live, insights.live].filter(Boolean).length;

  return (
    <div className="w-full min-h-screen" style={{ background: `radial-gradient(ellipse at top,#1E293B,${C.bg} 55%)`, color: C.text, fontFamily: "'IBM Plex Sans',-apple-system,sans-serif" }}>
      <div className="max-w-[1700px] mx-auto px-4 py-4 md:px-5 flex flex-col gap-4">
        <Header
          view={view} setView={setView}
          handleDispatch={handleDispatch} agents={agents} time={time}
          wsConnected={ws.connected} liveCount={liveCount}
          healthData={healthData} clawStatus={clawStatus}
          jobCount={jobsData.jobs?.length ?? null}
        />

        {/* Main grid — mobile: stacked, desktop: 2-col */}
        <div className="flex flex-col lg:grid lg:grid-cols-[1.4fr_0.6fr] gap-4">
          <div className="flex flex-col gap-4">
            {view === "site" && <SitePlan agents={agents} pos={pos} selAgent={selAgent} setSelAgent={setSelAgent} buildProg={buildProg} paused={paused} setPaused={setPaused} liveCount={liveCount} healthData={healthData} />}
            {view === "systems" && <SystemsView crons={cronsData.crons} handleRunCron={handleRunCron} healthData={healthData} cronsLive={cronsData.live} />}
            {view === "jobs" && <JobsView jobs={jobsData.jobs} live={jobsData.live} loading={jobsData.loading} />}
            {view === "billing" && <BillingView jobs={jobsData.jobs} />}
            {view === "bills" && <OpenBillsView jobs={jobsData.jobs} />}
            {view === "crew" && <CrewView agents={agents} selAgent={selAgent} setSelAgent={setSelAgent} />}
            {view === "costs" && <CostsView />}
            {view === "intel" && <IntelligenceView insights={insights} intelligence={intelligence} clawStatus={clawStatus} />}
            {view === "expertise" && <ExpertiseView expertise={expertise} />}
            {view === "land" && <LandFinderView />}
            {view === "roadmap" && <RoadmapView />}
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-4">
            <DetailPanel selAgent={selAgent} pos={pos} clawStatus={clawStatus} />
            <Timeline timeline={timeline} wsConnected={ws.connected} />
          </div>
        </div>
      </div>
    </div>
  );
}
