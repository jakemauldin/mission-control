import { useEffect, useRef, useState, useMemo } from "react";
import { C, crd, inn } from "../lib/colors";
import { Section } from "../components/ui/Card";
import { useApi } from "../hooks/useApi";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const fmt$ = (n) =>
  n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`;

const scoreColor = (s) => (s >= 80 ? "#22C55E" : s >= 60 ? "#84CC16" : s >= 40 ? "#EAB308" : s >= 20 ? "#F97316" : "#94A3B8");
const motivColor = (s) => (s >= 6 ? "#22C55E" : s >= 4 ? "#84CC16" : s >= 2 ? "#EAB308" : "#94A3B8");
const fcColor = (p) => (p.auction ? "#EF4444" : p.preForeclosure ? "#F97316" : p.foreclosure ? "#EAB308" : "#94A3B8");
const fcGlyph = (p) => (p.auction ? "A" : p.preForeclosure ? "P" : p.foreclosure ? "F" : "•");

const PRICE_STEPS = [["≤$800K", 800000], ["≤$1M", 1000000], ["≤$2M", 2000000], ["≤$5M", 5000000], ["Any", 0]];
const ACRE_STEPS = [["Any", 0], ["1+", 1], ["5+", 5], ["20+", 20], ["35+", 35]];
const DAY_STEPS = [["Any", 0], ["90d+", 90], ["180d+", 180], ["1yr+ stale", 365]];
const MOTIV_STEPS = [["Any", 0], ["3+", 3], ["5+", 5], ["6+", 6]];
const TYPE_STEPS = [["All", ""], ["SFR", "SFR"], ["Land", "LAND"], ["Condo", "CONDO"], ["Mobile", "MOBILE"]];
const getId = (r) => r.zpid || r.id;

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ padding: "3px 9px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: C.font, background: active ? C.accent : "rgba(255,255,255,0.05)", color: active ? "#FFF" : C.dim, transition: "all .15s" }}>{children}</button>
  );
}
function ChipRow({ label, steps, value, set }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: ".1em", color: C.dim, textTransform: "uppercase", width: 64 }}>{label}</span>
      {steps.map(([l, v]) => <Chip key={l} active={value === v} onClick={() => set(v)}>{l}</Chip>)}
    </div>
  );
}
const selStyle = { background: "rgba(255,255,255,0.05)", color: C.text, border: `1px solid ${C.bdr}`, borderRadius: 6, padding: "3px 8px", fontSize: 11, fontFamily: C.font };

export default function LandFinderView() {
  const [mode, setMode] = useState("listings"); // 'listings' | 'offmarket' | 'foreclosures'
  const listings = useApi("/api/land?market=telluride-vacation&pages=1&limit=500", null, { interval: 0 });
  const offmarket = useApi("/api/offmarket?market=telluride-vacation&size=25&limit=200", null, { interval: 0, enabled: mode === "offmarket" });
  const foreclosures = useApi("/api/foreclosures?counties=San%20Miguel%7COuray%7CMontrose&size=60", null, { interval: 0, enabled: mode === "foreclosures" });

  const live = mode === "listings" ? listings : mode === "offmarket" ? offmarket : foreclosures;
  const data = live.data;
  const rows = mode === "listings" ? (data?.deals || []) : (data?.parcels || []);

  const [maxPrice, setMaxPrice] = useState(800000);
  const [minAcres, setMinAcres] = useState(0);
  const [minDays, setMinDays] = useState(0);
  const [minMotiv, setMinMotiv] = useState(0);
  const [fcType, setFcType] = useState("");
  const [town, setTown] = useState("");
  const [sort, setSort] = useState("score");
  const [selId, setSelId] = useState(null);

  const towns = useMemo(() => [...new Set(rows.map((r) => r.city).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    if (mode === "listings") {
      const f = rows.filter((d) => (!maxPrice || d.price <= maxPrice) && (!minAcres || (d.acres || 0) >= minAcres) && (!minDays || d.daysOnMarket >= minDays) && (!town || d.city === town));
      const S = { score: (a, b) => b.score - a.score, price: (a, b) => a.price - b.price, acres: (a, b) => (b.acres || 0) - (a.acres || 0), days: (a, b) => b.daysOnMarket - a.daysOnMarket, ppa: (a, b) => (a.pricePerAcre || 9e15) - (b.pricePerAcre || 9e15) };
      return [...f].sort(S[sort] || S.score);
    }
    if (mode === "offmarket") {
      const f = rows.filter((p) => (!minMotiv || p.motivationScore >= minMotiv) && (!minAcres || (p.acres || 0) >= minAcres) && (!town || p.city === town));
      return [...f].sort(sort === "acres" ? (a, b) => (b.acres || 0) - (a.acres || 0) : (a, b) => b.motivationScore - a.motivationScore);
    }
    // foreclosures
    const f = rows.filter((p) => (!fcType || p.propertyType === fcType) && (!town || p.city === town));
    return [...f].sort(sort === "acres" ? (a, b) => (b.acres || 0) - (a.acres || 0) : (a, b) => (b.estimatedValue || 0) - (a.estimatedValue || 0));
  }, [mode, rows, maxPrice, minAcres, minDays, minMotiv, fcType, town, sort]);

  const mapEl = useRef(null), mapRef = useRef(null), layerRef = useRef(null), markerById = useRef({});
  useEffect(() => {
    if (mapRef.current || !mapEl.current) return;
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false }).setView([38.2, -107.9], 9);
    L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16 }).addTo(map);
    L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16 }).addTo(map);
    mapRef.current = map; layerRef.current = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 120);
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers(); markerById.current = {};
    const pts = [];
    filtered.forEach((d) => {
      if (typeof d.latitude !== "number" || typeof d.longitude !== "number") return;
      let color, popup;
      if (mode === "listings") {
        color = scoreColor(d.score);
        popup = `<div style="font:13px sans-serif;min-width:190px"><b>${fmt$(d.price)}</b> · ${d.acres ?? "?"} ac · ${d.daysOnMarket}d<br>${d.address || ""}<br>${d.pricePerAcre ? fmt$(d.pricePerAcre) + "/ac · " : ""}score <b>${d.score}</b><br>${d.detailUrl ? `<a href="${d.detailUrl}" target="_blank" rel="noopener">Zillow ↗</a>` : ""}</div>`;
      } else if (mode === "offmarket") {
        color = motivColor(d.motivationScore);
        popup = `<div style="font:13px sans-serif;min-width:200px"><b>${d.acres ?? "?"} ac</b> · ${d.city || ""} · motiv <b>${d.motivationScore}</b><br>${d.address || ""}<br>owner: ${d.owner || "?"} (${d.ownerType})<br><i>${(d.flags || []).join(", ")}</i><br>Off-market — skip-trace owner<br><a href="https://www.google.com/search?q=${encodeURIComponent((d.address || "") + " land")}" target="_blank" rel="noopener">Look up ↗</a></div>`;
      } else {
        color = fcColor(d);
        popup = `<div style="font:13px sans-serif;min-width:200px"><b>${d.propertyType}</b> · ${d.estimatedValue ? fmt$(d.estimatedValue) : "—"}<br>${d.address || ""}<br><i>${(d.stages || []).join(" / ")}</i>${d.mlsActive ? " · listed" : " · not listed"}<br>${d.zillowUrl ? `<a href="${d.zillowUrl}" target="_blank" rel="noopener">Zillow page ↗</a>` : ""}</div>`;
      }
      const m = L.circleMarker([d.latitude, d.longitude], { radius: 7, color: "#ffffffcc", weight: 1.5, fillColor: color, fillOpacity: 0.95 });
      m.bindPopup(popup);
      m.on("click", () => setSelId(getId(d)));
      m.addTo(layer); markerById.current[getId(d)] = m; pts.push([d.latitude, d.longitude]);
    });
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 12 });
  }, [filtered, mode]);

  function focus(d) {
    setSelId(getId(d));
    const m = markerById.current[getId(d)];
    if (m && mapRef.current) { mapRef.current.setView(m.getLatLng(), 13); m.openPopup(); }
  }

  return (
    <Section title="Land Finder — Telluride / San Miguel + Ouray (+ Montrose foreclosures)">
      <div className="flex gap-1 mb-3" style={{ background: "rgba(255,255,255,0.04)", padding: 3, borderRadius: 8, width: "fit-content" }}>
        {[["listings", "🏷️ Listings"], ["offmarket", "🎯 Off-market"], ["foreclosures", "⚖️ Foreclosures"]].map(([k, l]) => (
          <button key={k} onClick={() => { setMode(k); setSort("score"); setTown(""); }} style={{ padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: C.font, background: mode === k ? C.accent : "transparent", color: mode === k ? "#FFF" : C.dim }}>{l}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3" style={{ fontSize: 12, color: C.text }}>
        <span><b style={{ color: C.bright }}>{filtered.length}</b> of {rows.length}</span>
        {mode === "listings" && <span style={{ color: C.dim }}>median {data?.medianPricePerAcre ? fmt$(data.medianPricePerAcre) + "/ac" : "—"}</span>}
        {mode === "offmarket" && <span style={{ color: C.dim }}>ranked by owner motivation</span>}
        {mode === "foreclosures" && <span style={{ color: C.dim }}>pre-foreclosure / auction / foreclosure · most NOT listed</span>}
        {data?.mock && <span style={{ color: "#F97316", fontWeight: 700 }}>MOCK</span>}
        {live.error && <span style={{ color: "#DC2626" }}>connector offline</span>}
        <button onClick={live.refetch} disabled={live.loading} style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: "rgba(255,255,255,0.04)", color: C.text, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{live.loading ? "Loading…" : "↻ Refresh"}</button>
      </div>

      <div className="flex flex-col gap-2 mb-3">
        {mode === "listings" && <>
          <ChipRow label="Price" steps={PRICE_STEPS} value={maxPrice} set={setMaxPrice} />
          <ChipRow label="Acres" steps={ACRE_STEPS} value={minAcres} set={setMinAcres} />
          <ChipRow label="On mkt" steps={DAY_STEPS} value={minDays} set={setMinDays} />
        </>}
        {mode === "offmarket" && <>
          <ChipRow label="Motiv" steps={MOTIV_STEPS} value={minMotiv} set={setMinMotiv} />
          <ChipRow label="Acres" steps={ACRE_STEPS} value={minAcres} set={setMinAcres} />
        </>}
        {mode === "foreclosures" && <ChipRow label="Type" steps={TYPE_STEPS} value={fcType} set={setFcType} />}
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: ".1em", color: C.dim, textTransform: "uppercase", width: 64 }}>Town</span>
          <select value={town} onChange={(e) => setTown(e.target.value)} style={selStyle}><option value="">All</option>{towns.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: ".1em", color: C.dim, textTransform: "uppercase", marginLeft: 8 }}>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={selStyle}>
            {mode === "listings" && [["Score", "score"], ["Price ↑", "price"], ["Acres ↓", "acres"], ["Days ↓", "days"], ["$/acre ↑", "ppa"]].map(([l, v]) => <option key={v} value={v}>{l}</option>)}
            {mode === "offmarket" && [["Motivation", "score"], ["Acres ↓", "acres"]].map(([l, v]) => <option key={v} value={v}>{l}</option>)}
            {mode === "foreclosures" && [["Value ↓", "score"], ["Acres ↓", "acres"]].map(([l, v]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div ref={mapEl} style={{ height: 380, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.bdr}`, marginBottom: 12 }} />

      <div className="flex flex-col gap-1.5" style={{ maxHeight: 460, overflowY: "auto" }}>
        {filtered.map((d) => {
          const badge = mode === "listings" ? d.score : mode === "offmarket" ? d.motivationScore : fcGlyph(d);
          const badgeColor = mode === "listings" ? scoreColor(d.score) : mode === "offmarket" ? motivColor(d.motivationScore) : fcColor(d);
          const link = mode === "listings" ? d.detailUrl : mode === "foreclosures" ? d.zillowUrl : null;
          return (
            <div key={getId(d)} onClick={() => focus(d)} style={{ ...inn, padding: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, outline: selId === getId(d) ? `1px solid ${C.accent}` : "none" }}>
              <div style={{ minWidth: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: badgeColor, color: "#0A0A0A", fontWeight: 800, fontSize: 13 }}>{badge}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {mode === "listings" && <>
                  <div style={{ color: C.bright, fontWeight: 600, fontSize: 13 }}>{fmt$(d.price)} · {d.acres ?? "?"} ac · {d.daysOnMarket}d{d.priceReduced ? " · ▼" : ""}</div>
                  <div style={{ color: C.dim, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.address}{d.pricePerAcre ? ` · ${fmt$(d.pricePerAcre)}/ac` : ""}</div>
                </>}
                {mode === "offmarket" && <>
                  <div style={{ color: C.bright, fontWeight: 600, fontSize: 13 }}>{d.acres ?? "?"} ac · {d.city} · {d.owner || "?"}</div>
                  <div style={{ color: C.dim, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(d.flags || []).join(" · ") || "—"}</div>
                </>}
                {mode === "foreclosures" && <>
                  <div style={{ color: C.bright, fontWeight: 600, fontSize: 13 }}>{d.propertyType} · {d.estimatedValue ? fmt$(d.estimatedValue) : "—"}{d.acres ? ` · ${d.acres}ac` : ""}</div>
                  <div style={{ color: C.dim, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.address} · {(d.stages || []).join("/")}{d.mlsActive ? " · listed" : ""}</div>
                </>}
              </div>
              {link && <a href={link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: C.accent, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>Zillow ↗</a>}
            </div>
          );
        })}
        {!live.loading && filtered.length === 0 && (
          <div style={{ color: C.dim, fontSize: 12, padding: 16, textAlign: "center" }}>
            {rows.length ? "No matches for these filters." : (mode === "listings" ? "No data — is the connector running?" : "Switch loads this dataset…")}
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: C.dim }}>
        {mode === "listings" && "On-market (Zillow). Score = low $/acre + acreage, then days-on-market. Cached 6h."}
        {mode === "offmarket" && "Off-market (RealEstateAPI). Score = owner seller-motivation (out-of-state, long-held, estate, tax-lien) — not price."}
        {mode === "foreclosures" && "Distress pipeline (San Miguel + Ouray + Montrose). Most are NOT actively listed — pursue via county trustee/auction. P=pre-foreclosure, A=auction, F=foreclosure. Links open the Zillow property page (works even off-market)."}
      </div>
    </Section>
  );
}
