// Systems (DESIGN.md §6): outcomes, not liveness. Did the thing that was supposed to
// happen actually land, not "is the container up". No props — fetches its own data.
import { useState, useEffect, useCallback } from "react";
import { C, BRAND } from "../lib/colors";
import { btnS } from "../lib/helpers";
import { Section } from "../components/ui/Card";
import { useWebSocket } from "../hooks/useWebSocket";

const OK = "#4ade80";
const BAD = "#f87171";

// Shared Kasm Chrome (2026-08-23): the human viewer for the same browser Claude's
// automation drives over CDP (server/lib/kasm.js). "Open in shared browser" = POST to open
// or activate the tab server-side, then pop this viewer so Jake can see it land.
const KASM_VIEWER = "https://risingcreek-ai.taild0b4c6.ts.net:7901";

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

const tabInputS = {
  flex: "1 1 220px", minWidth: 0, fontSize: 13, padding: "7px 10px", borderRadius: 8,
  border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontFamily: "inherit",
};

function TabRow({ t, busy, onActivate, onClose }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.bright, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
        <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.hostname || t.url}</div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={btnS(false)} disabled={!!busy} onClick={() => onActivate(t.id)}>{busy === `view:${t.id}` ? "…" : "View"}</button>
        <button style={btnS(false)} disabled={!!busy} onClick={() => onClose(t.id)}>{busy === `close:${t.id}` ? "…" : "Close"}</button>
      </div>
    </div>
  );
}

// Shared browser (2026-08-23, Jake): container tiles link Jake straight to the tailnet UI —
// that stays the default click. This section is the separate hygiene/visibility piece for
// the OTHER browser, the one Claude's automation shares — tab count, view, close, open a URL.
function BrowserSection({ tabs, err, busy, note, urlInput, setUrlInput, onOpen, onActivate, onClose, onRefresh }) {
  return (
    <Section title="Shared browser">
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 10 }}>
        This is the Chrome Claude's automation uses too. Anything logged into here, it can see.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && urlInput.trim() && !busy) onOpen(urlInput.trim()); }}
          placeholder="https://…"
          style={tabInputS}
        />
        <button style={btnS(true)} disabled={!urlInput.trim() || !!busy} onClick={() => onOpen(urlInput.trim())}>
          {busy === "open" ? "Opening…" : "Open"}
        </button>
        <button style={btnS(false)} disabled={!!busy} onClick={onRefresh}>Refresh</button>
      </div>
      {note && <div style={{ fontSize: 12, color: C.text, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8, marginBottom: 10, whiteSpace: "pre-wrap" }}>{note}</div>}
      {err ? (
        <div style={{ color: C.dim, fontSize: 13 }}>{err}</div>
      ) : !tabs ? (
        <div style={{ color: C.dim, fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 4 }}>{tabs.length} tab{tabs.length === 1 ? "" : "s"} open</div>
          {tabs.length === 0 ? (
            <div style={{ color: C.dim, fontSize: 13 }}>No tabs open</div>
          ) : (
            tabs.map((t) => <TabRow key={t.id} t={t} busy={busy} onActivate={onActivate} onClose={onClose} />)
          )}
        </>
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

  // Shared browser: tab list polls independently of the outcomes panel (30s per spec,
  // vs. the 60s outcomes poll above) and only while this page is mounted.
  const [tabs, setTabs] = useState(null);
  const [tabsErr, setTabsErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const [urlInput, setUrlInput] = useState("");

  const loadTabs = useCallback(async () => {
    try {
      const r = await fetch("/api/browser/tabs");
      if (r.status === 401) { setTabsErr("session expired"); return; }
      const body = await r.json();
      if (!body.ok) { setTabsErr(body.message || `HTTP ${r.status}`); return; }
      setTabs(body.data);
      setTabsErr(null);
    } catch (e) {
      setTabsErr(e.message);
    }
  }, []);

  useEffect(() => { loadTabs(); const t = setInterval(loadTabs, 30000); return () => clearInterval(t); }, [loadTabs]);

  const openInShared = useCallback(async (url, busyKey = "open") => {
    setBusy(busyKey);
    setNote(`Opening ${url}…`);
    try {
      const r = await fetch("/api/browser/open", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
      });
      const body = await r.json();
      setNote(body.message || (body.ok ? "Opened" : "Failed"));
      if (body.ok) {
        window.open(KASM_VIEWER, "_blank", "noopener");
        if (busyKey === "open") setUrlInput("");
      }
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(null);
      loadTabs();
    }
  }, [loadTabs]);

  const activateTab = useCallback(async (id) => {
    setBusy(`view:${id}`);
    try {
      const r = await fetch(`/api/browser/tabs/${id}/activate`, { method: "POST" });
      const body = await r.json();
      setNote(body.message || (body.ok ? "Activated" : "Failed"));
      if (body.ok) window.open(KASM_VIEWER, "_blank", "noopener");
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(null);
      loadTabs();
    }
  }, [loadTabs]);

  const closeTab = useCallback(async (id) => {
    setBusy(`close:${id}`);
    try {
      const r = await fetch(`/api/browser/tabs/${id}/close`, { method: "POST" });
      const body = await r.json();
      setNote(body.message || (body.ok ? "Closed" : "Failed"));
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(null);
      loadTabs();
    }
  }, [loadTabs]);

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
              <div key={`${c.name}-${i}`} title={c.note || c.detail || ""} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, minWidth: 0, flexWrap: "wrap" }}>
                <Dot ok={c.ok} />
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: BRAND.link, fontWeight: 600, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</a>
                ) : (
                  <span style={{ fontSize: 12, color: C.bright, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                )}
                <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 0 }}>
                  {c.kasmUrl && (
                    <button
                      title="Open in the shared browser Claude's automation uses (not your own tailnet session)"
                      disabled={busy === `kasm:${c.name}`}
                      onClick={() => openInShared(c.kasmUrl, `kasm:${c.name}`)}
                      style={{ fontSize: 10, color: C.dim, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", fontFamily: "inherit" }}
                    >
                      {busy === `kasm:${c.name}` ? "opening…" : "kasm ↗"}
                    </button>
                  )}
                  {c.source && (
                    <a href={c.source} target="_blank" rel="noopener noreferrer" title="source" style={{ fontSize: 10, color: C.dim, textDecoration: "none" }}>src ↗</a>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <BrowserSection
        tabs={tabs} err={tabsErr} busy={busy} note={note}
        urlInput={urlInput} setUrlInput={setUrlInput}
        onOpen={(url) => openInShared(url, "open")}
        onActivate={activateTab} onClose={closeTab} onRefresh={loadTabs}
      />

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
