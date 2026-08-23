// Per-section favicons (Jake, 8/23): each tab shows WHICH part of Mission Control
// it is — logo + a colored letter badge — plus a matching document title.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const MAP = [
  [/^\/money/, "money", "Money"],
  [/^\/media/, "media", "Media"],
  [/^\/rfis/, "rfis", "RFIs"],
  [/^\/jobs/, "jobs", "Jobs"],
  [/^\/systems/, "systems", "Systems"],
  [/^\/projects/, "projects", "Projects"],
  [/^\/land/, "land", "Land"],
  [/^\//, "brief", "Brief"],
];

export function useFavicon() {
  const { pathname } = useLocation();
  useEffect(() => {
    const [, name, label] = MAP.find(([re]) => re.test(pathname)) || MAP[MAP.length - 1];
    let link = document.querySelector('link[rel="icon"][sizes="32x32"]') || document.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.href = `/favicon-${name}.png`;
    document.title = `${label} — Rising Creek`;
  }, [pathname]);
}
