// Systems (DESIGN.md §6): outcomes, not liveness. Did the thing that was supposed to
// happen actually land, not "is the container up". No props — fetches its own data.
import { useState, useEffect, useCallback } from "react";
import { C } from "../lib/colors";
import { Section } from "../components/ui/Card";
import { useWebSocket } from "../hooks/useWebSocket";

const OK = "#4ade80";
const BAD = "#f87171";

function Dot({ ok }) {
  return <span style={{ width: 8, height: 8, borderRadius: "50%", background: ok ? OK : BAD, flexShrink: 0, display: "inline-block" }} />;
}

function OutcomeRow({ item }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.bdr}` }}>
      <Dot ok={item.ok} />
      <span style={{ fontSize: 13, fontWeight: 600, color: C.bright, minWidth: 140 }}>{item.name}</span>
      <span style={{ flex: 1, fontSize: 12, color: C.dim }}>{item.detail || ""}</span>
      {typeof item.pct === "number" && (
        <span style={{ fontSize: 11, color: C.dim, fontFamily: C.mono }}>
          {item.pct}% used{typeof item.freeGB === "number" ? ` · ${item.freeGB}GB free` : ""}
        </span>
      )}
      {item.owner && <span style={{ fontSize: 11, color: C.dim }}>{item.owner}</span>}
      {typeof item.ageHours === "number" && <span style={{ fontSize: 11, color: C.dim, fontFamily: C.mono }}>{item.ageHours}h old</span>}
    </div>
  );
}

function Group({ title, items }) {
  return (
    <Section title={title}>
      {!items || items.length === 0 ? (
        <div style={{ color: C.dim, fontSize: 13 }}>No data</div>
      ) : (
        items.map((it, i) => <OutcomeRow key={`${it.name}-${i}`} item={it} />)
      )}
    </Section>
  );
}

export default function SystemsView() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const { lastMessage } = useWebSocket();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/systems/outcomes");
      if (r.status === 401) { setErr("session expired"); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      setData(body.data);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (lastMessage?.type === "systems_update") load(); }, [lastMessage, load]);

  if (err) return <Section title="Systems"><div style={{ color: C.dim }}>{err}</div></Section>;
  if (!data) return <Section title="Systems"><div style={{ color: C.dim }}>Loading…</div></Section>;

  const backups = data.backups || [];
  const disk = data.disk || [];
  const crons = data.crons || [];
  const containers = data.containers || [];
  const health = data.health;

  const attention = [...backups, ...disk, ...crons, ...containers, ...(health ? [health] : [])].filter((it) => it && it.ok === false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Attention">
        {attention.length === 0 ? (
          <div style={{ color: OK, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <Dot ok={true} /> All outcomes landed
          </div>
        ) : (
          attention.map((it, i) => <OutcomeRow key={`${it.kind}-${it.name}-${i}`} item={it} />)
        )}
      </Section>

      <Group title="Backups" items={backups} />
      <Group title="Disk" items={disk} />
      <Group title="Scheduled jobs" items={crons} />

      <Section title="Containers">
        {containers.length === 0 ? (
          <div style={{ color: C.dim, fontSize: 13 }}>No data</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
            {containers.map((c, i) => (
              <div key={`${c.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
                <Dot ok={c.ok} />
                <span style={{ fontSize: 12, color: C.bright, fontWeight: 600 }}>{c.name}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Health snapshot">
        <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>
          01:00 daily snapshot — can lag live state.
        </div>
        {health ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <Dot ok={health.ok} />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.bright }}>{health.status || health.name}</span>
            <span style={{ flex: 1, fontSize: 12, color: C.dim }}>{health.detail}</span>
          </div>
        ) : (
          <div style={{ color: C.dim, fontSize: 13 }}>No data</div>
        )}
      </Section>

      {data.generated && (
        <div style={{ fontSize: 11, color: C.dim, textAlign: "right" }}>generated {data.generated}</div>
      )}
    </div>
  );
}
