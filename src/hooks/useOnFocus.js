import { useEffect, useRef } from "react";

// Runs fn when the tab comes back into view after at least minGapMs hidden, so a page left
// open all day catches up when Jake returns to it instead of showing what it loaded at 7 am
// (audit 2026-10-12: Land, Expertise, Access, Media and the RFI list loaded once and never again).
export function useOnFocus(fn, minGapMs = 60_000) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= minGapMs) ref.current();
      hiddenAt = 0;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [minGapMs]);
}
