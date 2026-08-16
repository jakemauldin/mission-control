import { C, crd, inn } from "../lib/colors";
import { IconClock } from "./Icons";
import CommandBar from "./CommandBar";

const TABS = [
  { k: "site", l: "Site" },
  { k: "projects", l: "Projects" },
  { k: "systems", l: "Systems" },
  { k: "jobs", l: "Jobs" },
  { k: "billing", l: "Billing" },
  { k: "bills", l: "AP Bills" },
  { k: "crew", l: "Crew" },
  { k: "costs", l: "Costs" },
  { k: "intel", l: "Intel" },
  { k: "expertise", l: "Growth" },
  { k: "land", l: "Land" },
  { k: "roadmap", l: "Roadmap" },
];

export default function Header({ view, setView, handleDispatch, agents, time, wsConnected, liveCount, healthData, jobCount, clawStatus }) {
  const degradedCount = healthData?.live && healthData.data
    ? (typeof healthData.data === "object" ? Object.values(healthData.data).filter((v) => v === "degraded" || v === "warning").length : 0)
    : 0;

  const clawOk = clawStatus?.live;

  const stats = [
    { l: "Health", v: healthData?.live ? `${degradedCount} issues` : "No data", c: healthData?.live ? (degradedCount > 0 ? "#DC2626" : "#2A9D8F") : "#64748B" },
    { l: "Jobs", v: jobCount != null ? `${jobCount} active` : "No data", c: jobCount != null ? "#4A90D9" : "#64748B" },
    { l: "OpenClaw", v: clawOk ? "Connected" : "Offline", c: clawOk ? "#2A9D8F" : "#64748B" },
    { l: "Live Sources", v: `${liveCount}`, c: liveCount > 0 ? "#E8722A" : "#64748B" },
  ];

  return (
    <div style={{ ...crd, padding: "16px 20px" }}>
      <div className="flex flex-wrap gap-4 items-end justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.2em", color: C.accent, textTransform: "uppercase" }}>Rising Creek</div>
            <h1 className="text-xl md:text-2xl font-bold mt-1" style={{ color: C.bright, letterSpacing: "-0.02em", fontFamily: "'IBM Plex Sans', sans-serif" }}>
              Mission Control
            </h1>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
            <IconClock size={11} />
            <span className="mono" style={{ fontSize: 10, color: C.dim }}>
              {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          {/* Live indicator */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: wsConnected ? "rgba(42,157,143,0.08)" : "rgba(255,255,255,0.03)" }}>
            <div style={{
              width: 5, height: 5, borderRadius: "50%",
              background: wsConnected ? "#2A9D8F" : "#475569",
              animation: wsConnected ? "pulse 2s infinite" : "none",
            }} />
            <span style={{ fontSize: 9, color: wsConnected ? "#A7F3D0" : C.dim, fontWeight: 600 }}>
              {wsConnected ? `LIVE · ${liveCount} sources` : "OFFLINE"}
            </span>
          </div>
        </div>

        {/* Command bar + tabs */}
        <div className="flex flex-col gap-2 flex-1 max-w-xl items-end">
          <CommandBar onDispatch={handleDispatch} connected={wsConnected} />
          <div className="flex gap-0.5 rounded-lg p-0.5 flex-wrap" style={{ background: "rgba(255,255,255,0.04)" }}>
            {TABS.map((t) => (
              <button
                key={t.k}
                onClick={() => setView(t.k)}
                className="whitespace-nowrap"
                style={{
                  padding: "4px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                  fontSize: 10, fontWeight: 600, fontFamily: "'IBM Plex Sans', sans-serif",
                  background: view === t.k ? C.accent : "transparent",
                  color: view === t.k ? "#FFF" : C.dim,
                  transition: "all 0.15s",
                }}
              >
                {t.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        {stats.map((s) => (
          <div key={s.l} style={{ ...inn, padding: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", color: C.dim, textTransform: "uppercase" }}>{s.l}</div>
            <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700, color: s.c }}>{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
