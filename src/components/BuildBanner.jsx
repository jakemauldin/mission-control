import { useCallback, useEffect, useRef, useState } from "react";
import { C, BRAND } from "../lib/colors";
import { useWebSocket } from "../hooks/useWebSocket";
import { useOnFocus } from "../hooks/useOnFocus";

// A tab left open keeps running the bundle it loaded, so after a deploy Jake was looking at old
// screens without knowing it. The server reports dist/index.html's build stamp (GET /api/build)
// and pushes build_update when it changes; when it no longer matches what this tab started with,
// say so and offer the reload.
export default function BuildBanner() {
  const [stale, setStale] = useState(false);
  const first = useRef(undefined);
  const check = useCallback(() => fetch("/api/build")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d?.build) return;
      if (first.current === undefined) first.current = d.build;
      else if (d.build !== first.current) setStale(true);
    })
    .catch(() => {}), []);
  useEffect(() => { Promise.resolve().then(check); }, [check]);
  const ws = useWebSocket();
  useEffect(() => { if (ws.lastMessage?.type === "build_update") check(); }, [ws.lastMessage, check]);
  useOnFocus(check, 0);
  if (!stale) return null;
  return (
    <div role="status" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", margin: "-8px 0 14px", padding: "8px 12px", borderRadius: 10, border: `1px solid ${BRAND.border}`, background: "rgba(122,178,255,0.10)", fontSize: 13, color: C.bright }}>
      <span>The dashboard was updated. This tab is showing the old version.</span>
      <button onClick={() => window.location.reload()}
        style={{ fontSize: 12, padding: "5px 12px", borderRadius: 8, border: `1px solid ${BRAND.border}`, background: "transparent", color: BRAND.focus, cursor: "pointer" }}>
        Reload
      </button>
    </div>
  );
}
