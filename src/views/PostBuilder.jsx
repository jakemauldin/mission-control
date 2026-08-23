// Social Post Builder v3 (Jake, 8/23): placement-level previews, modeled on Meta
// Ads Manager's "All previews" (his screen recording) — one composition rendered
// per PLACEMENT (FB desktop/mobile/story/in-stream, IG feed/story/reel, ...), not
// one generic card per platform. YouTube and Houzz added as targets. AI suggestions
// (captions + photo picks, learning loop) and true link unfurls carry over.
import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { C, BRAND } from "../lib/colors";
import { Section } from "../components/ui/Card";

const AVATAR = "/logo-64.png";
const NAME = "Rising Creek Construction";

const PLATFORMS = {
  facebook:  { label: "Facebook",  trunc: 280, cap: 8000, handle: NAME,
               placements: ["Desktop feed", "Mobile feed", "Story", "In-stream"] },
  instagram: { label: "Instagram", trunc: 125, cap: 2200, handle: "risingcreekconstruction",
               placements: ["Feed", "Story", "Reel"] },
  gbp:       { label: "Google",    trunc: 1500, cap: 1500, handle: NAME, placements: ["Post"] },
  x:         { label: "X",         trunc: 280, cap: 280,  handle: "@risingcreek", placements: ["Feed"] },
  pinterest: { label: "Pinterest", trunc: 100, cap: 500,  handle: NAME, placements: ["Pin"] },
  linkedin:  { label: "LinkedIn",  trunc: 210, cap: 3000, handle: NAME, placements: ["Feed"] },
  youtube:   { label: "YouTube",   trunc: 100, cap: 5000, handle: NAME, placements: ["Home feed"] },
  houzz:     { label: "Houzz",     trunc: 160, cap: 1000, handle: NAME, placements: ["Project"] },
};

function lint(text, platform) {
  const warns = [];
  if (/\$\s?\d[\d,]*(\s?(?:-|–|to)\s?\$?\d[\d,]*)?/i.test(text)) warns.push("Never put project-size $ figures in public copy (house rule).");
  if (/dirt\s*to\s*done/i.test(text)) warns.push('"Dirt to Done" is a competitor\'s line — use "Built like it\'s ours."');
  if (platform === "x" && text.length > 280) warns.push(`X hard limit: ${text.length}/280 — this will not post.`);
  if (platform === "gbp" && /#\w/.test(text)) warns.push("GBP ignores hashtags — they read as clutter there.");
  if (platform === "instagram" && !/#\w/.test(text)) warns.push("Instagram reach benefits from 3-5 tags.");
  if (platform === "instagram" && /https?:\/\//.test(text)) warns.push("Links are NOT clickable in Instagram captions — use link-in-bio.");
  if (platform === "youtube" && text.split("\n")[0].length > 100) warns.push("YouTube title (first line) over 100 chars — it truncates.");
  return warns;
}

// ── platform-exact rendering primitives ──────────────────────────────────────
// Fonts are each platform's real stack; icons are inline SVG traced from the
// platforms' current glyphs; engagement is ZERO-STATE (a fresh post shows no
// counts) — fabricated numbers would make the preview a lie.
const FONT = {
  facebook: "Segoe UI, Helvetica, Arial, sans-serif",
  instagram: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  x: "'TwitterChirp', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  gbp: "'Google Sans', Roboto, Arial, sans-serif",
  youtube: "Roboto, Arial, sans-serif",
  linkedin: "-apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  pinterest: "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif",
  houzz: "'Helvetica Neue', Helvetica, Arial, sans-serif",
};
const I = ({ d, size = 18, color = "currentColor", vb = "0 0 24 24" }) => (
  <svg width={size} height={size} viewBox={vb} fill="none" style={{ display: "block" }}>
    <path d={d} fill={color} />
  </svg>
);
const ICON = {
  fbLike: "M7 10v10H4a1 1 0 01-1-1v-8a1 1 0 011-1h3zm2 10V9.83l4.06-6.09a1.5 1.5 0 012.72 1.13L15 9h5a2 2 0 012 2.4l-1.44 6.77A2.5 2.5 0 0118.11 20H9z",
  fbComment: "M12 3C6.48 3 2 6.92 2 11.75c0 2.6 1.33 4.93 3.45 6.53L5 21.5l3.8-2.05c1 .26 2.07.4 3.2.4 5.52 0 10-3.92 10-8.75S17.52 3 12 3z",
  fbShare: "M14 5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1.5-5 3.5-9.9 11-10.9V5z",
  igHeart: "M16.5 3.5c-1.74 0-3.41.9-4.5 2.34C10.91 4.4 9.24 3.5 7.5 3.5 4.42 3.5 2 5.92 2 9c0 3.78 3.4 6.86 8.55 11.53L12 21.85l1.45-1.32C18.6 15.86 22 12.78 22 9c0-3.08-2.42-5.5-5.5-5.5z",
  igComment: "M12 2C6.48 2 2 6.02 2 11c0 2.72 1.35 5.15 3.47 6.8L4.5 22l4.42-2.32c.98.21 2.01.32 3.08.32 5.52 0 10-4.02 10-9S17.52 2 12 2z",
  igSend: "M22 3L2 10.53l7.08 2.4L11.5 20 22 3zM9.5 13.3L19 5.5l-8.4 9.1-.1 3.2-1-4.5z",
  igSave: "M6 3h12a1 1 0 011 1v17l-7-5-7 5V4a1 1 0 011-1z",
  xReply: "M9 17l-5-5 5-5v3.5c5.5 0 9 2 11 6.5-2.5-2.5-5.5-3.5-11-3.5V17z",
  xRT: "M7 7h7a3 3 0 013 3v1h-2l3 4 3-4h-2v-1a5 5 0 00-5-5H7v2zm10 10h-7a3 3 0 01-3-3v-1h2L6 9l-3 4h2v1a5 5 0 005 5h7v-2z",
  xLike: "M12 21S3 14.5 3 8.8C3 5.6 5.4 3.5 8 3.5c1.7 0 3.2.9 4 2.2.8-1.3 2.3-2.2 4-2.2 2.6 0 5 2.1 5 5.3 0 5.7-9 12.2-9 12.2z",
  xViews: "M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z",
  liLike: "M7 10v10H4a1 1 0 01-1-1v-8a1 1 0 011-1h3zm2 10V9.83l4.06-6.09a1.5 1.5 0 012.72 1.13L15 9h5a2 2 0 012 2.4l-1.44 6.77A2.5 2.5 0 0118.11 20H9z",
  liComment: "M7 9h10v1.5H7V9zm0 3h7v1.5H7V12zm14-6.5v13l-4-3.5H5a2 2 0 01-2-2v-7.5a2 2 0 012-2h14a2 2 0 012 2z",
  liRepost: "M4 10l4-4v3h8a3 3 0 013 3v2h-2v-2a1 1 0 00-1-1H8v3l-4-4zm16 4l-4 4v-3H8a3 3 0 01-3-3v-2h2v2a1 1 0 001 1h8v-3l4 4z",
  liSend: "M21 3L3 10.5l6.5 2L12 19l2.5-5.5L21 3z",
};
// URLs render as links on-platform (except IG, where they are dead text — that IS the accuracy)
function linkify(text, color, dead) {
  const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => /^https?:\/\//.test(p)
    ? <span key={i} style={dead ? {} : { color }}>{dead ? p : p.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
    : <span key={i}>{p}</span>);
}

function Media({ refs, aspect, single }) {
  if (!refs.length) return <div style={{ aspectRatio: aspect, background: "#e4e6eb", display: "grid", placeItems: "center", color: "#8a8d91", fontSize: 12 }}>no image attached</div>;
  const img = (r, st) => <img key={r} src={`/api/media/thumb?rel=${encodeURIComponent(r)}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...st }} />;
  if (single || refs.length === 1) return <div style={{ aspectRatio: aspect, overflow: "hidden" }}>{img(refs[0])}</div>;
  // Facebook's real multi-photo grids (square sources): 2 = two columns;
  // 3 = one full-width on top, two below; 4+ = 2x2 with +N on the last cell.
  if (refs.length === 2) return <div style={{ aspectRatio: aspect, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>{refs.slice(0, 2).map(r => img(r))}</div>;
  if (refs.length === 3) return (
    <div style={{ display: "grid", gridTemplateRows: "1.2fr 1fr", gap: 2, aspectRatio: aspect }}>
      {img(refs[0])}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>{img(refs[1])}{img(refs[2])}</div>
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 2, aspectRatio: "1/1" }}>
      {img(refs[0])}{img(refs[1])}{img(refs[2])}
      <div style={{ position: "relative" }}>
        {img(refs[3])}
        {refs.length > 4 && <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center", color: "#fff", fontSize: 22, fontWeight: 600 }}>+{refs.length - 4}</div>}
      </div>
    </div>
  );
}

function Caption({ text, trunc, more = "See more", moreColor = "#65676b", linkColor = "#216fdb", deadLinks = false }) {
  const over = text.length > trunc;
  const t = over ? text.slice(0, trunc).trimEnd() : text;
  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      {linkify(t, linkColor, deadLinks)}
      {over && <span style={{ color: moreColor }}>… {more}</span>}
    </span>
  );
}

function LinkCard({ link, aspect, dark }) {
  if (!link) return null;
  const strip = { padding: "8px 12px", background: dark ? "#16181c" : "#f0f2f5", borderTop: dark ? "1px solid #2f3336" : "1px solid #dddfe2" };
  return (
    <div style={{ border: dark ? "1px solid #2f3336" : "1px solid #dddfe2", borderRadius: dark ? 16 : 0, overflow: "hidden" }}>
      {link.image
        ? <img src={link.image} alt="" style={{ width: "100%", aspectRatio: aspect, objectFit: "cover", display: "block" }} />
        : <div style={{ aspectRatio: aspect, background: dark ? "#202327" : "#e4e6eb", display: "grid", placeItems: "center" }}>
            <img src={link.icon} alt="" style={{ width: 48, height: 48 }} onError={e => { e.target.style.display = "none"; }} /></div>}
      <div style={strip}>
        <div style={{ fontSize: 12, color: dark ? "#71767b" : "#65676b", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5, letterSpacing: .2 }}>
          <img src={link.icon} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} onError={e => { e.target.style.display = "none"; }} />
          {link.domain}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: dark ? "#e7e9ea" : "#050505", lineHeight: 1.25, marginTop: 2 }}>{link.title}</div>
        {link.description && <div style={{ fontSize: 13, color: dark ? "#71767b" : "#606770", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{link.description}</div>}
      </div>
    </div>
  );
}

function StoryFrame({ caption, refs, cta, reel, handle }) {
  const bg = refs[0] ? `url(/api/media/thumb?rel=${encodeURIComponent(refs[0])})` : "linear-gradient(#3a3a2a,#111)";
  return (
    <div style={{ width: 250, aspectRatio: "9/16", borderRadius: 18, overflow: "hidden", position: "relative", background: bg, backgroundSize: "cover", backgroundPosition: "center", border: "1px solid #333", fontFamily: FONT.instagram }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,.45), transparent 25%, transparent 60%, rgba(0,0,0,.6))" }} />
      <div style={{ position: "absolute", top: 10, left: 10, right: 10, display: "flex", alignItems: "center", gap: 7 }}>
        {!reel && <div style={{ position: "absolute", top: -4, left: 0, right: 0, height: 2, background: "rgba(255,255,255,.35)", borderRadius: 1 }}><div style={{ width: "35%", height: "100%", background: "#fff", borderRadius: 1 }} /></div>}
        <img src={AVATAR} alt="" style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid rgba(255,255,255,.6)" }} />
        <span style={{ color: "#fff", fontSize: 13, fontWeight: 600, textShadow: "0 1px 2px rgba(0,0,0,.6)" }}>{handle}</span>
        <span style={{ color: "rgba(255,255,255,.75)", fontSize: 11 }}>Sponsored</span>
      </div>
      {reel && (
        <div style={{ position: "absolute", right: 8, bottom: 70, display: "flex", flexDirection: "column", gap: 16, alignItems: "center", color: "#fff", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.7))" }}>
          <I d={ICON.igHeart} size={26} color="#fff" /><I d={ICON.igComment} size={26} color="#fff" /><I d={ICON.igSend} size={26} color="#fff" />
        </div>
      )}
      <div style={{ position: "absolute", left: 10, right: reel ? 48 : 10, bottom: 46, color: "#fff", fontSize: 12.5, lineHeight: 1.4, textShadow: "0 1px 3px rgba(0,0,0,.8)", maxHeight: 84, overflow: "hidden" }}>
        {caption.slice(0, 140)}{caption.length > 140 ? "…" : ""}
      </div>
      <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 10, background: "#fff", color: "#050505", borderRadius: 20, padding: "7px 18px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{cta}</div>
    </div>
  );
}

function Preview({ platform, placement, caption, refs, link }) {
  const P = PLATFORMS[platform];
  const ff = FONT[platform];
  const light = { background: "#fff", color: "#050505", borderRadius: 8, overflow: "hidden", maxWidth: 420, fontFamily: ff, border: "1px solid #dddfe2", boxShadow: "0 1px 2px rgba(0,0,0,.1)" };
  const head = (name, sub, round = true, verified = false) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 12px 8px" }}>
      <img src={AVATAR} alt="" style={{ width: 40, height: 40, borderRadius: round ? "50%" : 6 }} />
      <div style={{ lineHeight: 1.25 }}>
        <div style={{ fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", gap: 4 }}>
          {name}{verified && <span style={{ color: "#1877f2", fontSize: 13 }}>✔</span>}
        </div>
        <div style={{ fontSize: 12.5, color: "#65676b" }}>{sub}</div>
      </div>
      <span style={{ marginLeft: "auto", color: "#65676b", fontWeight: 700, letterSpacing: 1 }}>⋯</span>
    </div>
  );
  const actionBar = (items, color) => (
    <div style={{ display: "flex", borderTop: "1px solid #e4e6eb", margin: "0 12px", padding: "4px 0" }}>
      {items.map(([icon, label]) => (
        <span key={label} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", color, fontSize: 14, fontWeight: 600 }}>
          <I d={icon} size={18} color={color} />{label}
        </span>
      ))}
    </div>
  );

  if (platform === "facebook") {
    if (placement === "Story") return <StoryFrame caption={caption} refs={refs} cta="Send message" handle={NAME} />;
    if (placement === "In-stream") return (
      <div style={{ background: "#000", borderRadius: 8, overflow: "hidden", maxWidth: 420, fontFamily: ff, border: "1px solid #333" }}>
        <div style={{ aspectRatio: "16/9", position: "relative" }}>
          <Media refs={refs} aspect="16/9" single />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,.78)", padding: "8px 12px", display: "flex", gap: 8, alignItems: "center" }}>
            <img src={AVATAR} alt="" style={{ width: 28, height: 28, borderRadius: "50%" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fff", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{NAME}</div>
              <div style={{ color: "#b0b3b8", fontSize: 11 }}>Sponsored</div>
            </div>
            <span style={{ background: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 600 }}>Send message</span>
          </div>
        </div>
      </div>
    );
    const mobile = placement === "Mobile feed";
    return (
      <div style={{ ...light, maxWidth: mobile ? 340 : 420 }}>
        {head(NAME, "Just now · 🌐", true, true)}
        <div style={{ padding: "0 12px 10px", fontSize: 15, lineHeight: 1.33 }}>
          <Caption text={caption} trunc={mobile ? 200 : P.trunc} more="See more" linkColor="#216fdb" />
        </div>
        {refs.length === 0 && link ? <LinkCard link={link} aspect="1.91/1" /> : <Media refs={refs} aspect={mobile ? "1/1" : "1.91/1"} />}
        {actionBar([[ICON.fbLike, "Like"], [ICON.fbComment, "Comment"], [ICON.fbShare, "Share"]], "#65676b")}
      </div>
    );
  }

  if (platform === "instagram") {
    if (placement === "Story") return <StoryFrame caption={caption} refs={refs} cta="Learn more" handle={P.handle} />;
    if (placement === "Reel") return <StoryFrame caption={caption} refs={refs} cta="Send message" handle={P.handle} reel />;
    return (
      <div style={{ ...light, maxWidth: 380, borderRadius: 4, border: "1px solid #dbdbdb", boxShadow: "none" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px" }}>
          <img src={AVATAR} alt="" style={{ width: 32, height: 32, borderRadius: "50%", outline: "2px solid #fff", boxShadow: "0 0 0 3.5px #d62976" }} />
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{P.handle}</span>
          <span style={{ marginLeft: "auto", fontWeight: 700, letterSpacing: 1, color: "#262626" }}>⋯</span>
        </div>
        <Media refs={refs} aspect="1/1" single />
        <div style={{ display: "flex", gap: 14, padding: "10px 12px 6px", alignItems: "center", color: "#262626" }}>
          <I d={ICON.igHeart} size={24} /><I d={ICON.igComment} size={24} /><I d={ICON.igSend} size={24} />
          {refs.length > 1 && <span style={{ position: "absolute" }} />}
          <span style={{ marginLeft: "auto" }}><I d={ICON.igSave} size={24} /></span>
        </div>
        {refs.length > 1 && <div style={{ textAlign: "center", fontSize: 8, color: "#0095f6", marginTop: -20, marginBottom: 8 }}>{refs.map((_, i) => i === 0 ? "●" : "○").join(" ")}</div>}
        <div style={{ padding: "0 12px 14px", fontSize: 14, lineHeight: 1.4 }}>
          <b>{P.handle}</b>{" "}
          <Caption text={caption} trunc={P.trunc} more="more" moreColor="#8e8e8e" deadLinks />
        </div>
      </div>
    );
  }

  if (platform === "x") return (
    <div style={{ background: "#000", color: "#e7e9ea", borderRadius: 16, overflow: "hidden", maxWidth: 420, fontFamily: ff, border: "1px solid #2f3336", padding: "12px 16px" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <img src={AVATAR} alt="" style={{ width: 40, height: 40, borderRadius: "50%" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 5, alignItems: "baseline", fontSize: 15 }}>
            <span style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{NAME}</span>
            <span style={{ color: "#71767b", fontSize: 14 }}>{P.handle} · now</span>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.35, marginTop: 2 }}>
            <Caption text={caption} trunc={280} more="" linkColor="#1d9bf0" />
          </div>
          {refs.length === 0 && link
            ? <div style={{ marginTop: 10 }}><LinkCard link={link} aspect="16/9" dark /></div>
            : refs.length > 0 && <div style={{ marginTop: 10, borderRadius: 16, overflow: "hidden", border: "1px solid #2f3336" }}><Media refs={refs} aspect="16/9" /></div>}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, maxWidth: 320, color: "#71767b" }}>
            <I d={ICON.xReply} size={17} color="#71767b" /><I d={ICON.xRT} size={17} color="#71767b" /><I d={ICON.xLike} size={17} color="#71767b" /><I d={ICON.xViews} size={17} color="#71767b" />
          </div>
        </div>
      </div>
    </div>
  );

  if (platform === "gbp") return (
    <div style={{ ...light, borderRadius: 12, maxWidth: 360 }}>
      <Media refs={refs} aspect="4/3" single />
      <div style={{ padding: "12px 16px 4px", fontSize: 12, color: "#5f6368" }}>{NAME} · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
      <div style={{ padding: "0 16px 10px", fontSize: 14, lineHeight: 1.45, color: "#3c4043" }}><Caption text={caption} trunc={P.trunc} linkColor="#1a73e8" /></div>
      <div style={{ padding: "0 16px 14px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#1a73e8", fontSize: 14, fontWeight: 500 }}>Learn more</span>
        {link && <span style={{ fontSize: 11, color: "#5f6368" }}>→ {link.domain}</span>}
      </div>
    </div>
  );

  if (platform === "pinterest") return (
    <div style={{ maxWidth: 236, fontFamily: ff }}>
      <div style={{ borderRadius: 16, overflow: "hidden" }}><Media refs={refs} aspect="2/3" single /></div>
      <div style={{ padding: "8px 4px 2px", fontSize: 14, fontWeight: 600, color: C.bright, lineHeight: 1.3 }}>
        {caption.split("\n")[0].slice(0, P.trunc) || "Pin title (first caption line)"}
      </div>
      <div style={{ padding: "0 4px", fontSize: 12, color: C.dim, display: "flex", gap: 6, alignItems: "center" }}>
        <img src={AVATAR} alt="" style={{ width: 24, height: 24, borderRadius: "50%" }} /> {NAME}
        {link && <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <img src={link.icon} alt="" style={{ width: 12, height: 12 }} onError={e => { e.target.style.display = "none"; }} />{link.domain}</span>}
      </div>
    </div>
  );

  if (platform === "youtube") {
    const [title, ...rest] = caption.split("\n");
    return (
      <div style={{ maxWidth: 380, fontFamily: ff }}>
        <div style={{ borderRadius: 12, overflow: "hidden", position: "relative" }}>
          <Media refs={refs} aspect="16/9" single />
        </div>
        <div style={{ display: "flex", gap: 10, paddingTop: 10 }}>
          <img src={AVATAR} alt="" style={{ width: 36, height: 36, borderRadius: "50%" }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 500, color: C.bright, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{title.slice(0, 100) || "Video title (first caption line)"}</div>
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 3 }}>{NAME}</div>
            <div style={{ fontSize: 12.5, color: C.dim }}>No views · just now</div>
          </div>
        </div>
        {rest.length > 0 && <div style={{ fontSize: 12, color: C.dim, marginTop: 6, paddingLeft: 46, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rest.join(" ").slice(0, 90)}</div>}
      </div>
    );
  }

  if (platform === "houzz") return (
    <div style={{ ...light, maxWidth: 340, borderRadius: 6 }}>
      <Media refs={refs} aspect="4/3" single />
      <div style={{ padding: "10px 12px 4px", display: "flex", alignItems: "center", gap: 8 }}>
        <img src={AVATAR} alt="" style={{ width: 34, height: 34, borderRadius: 4 }} />
        <div style={{ lineHeight: 1.3 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, color: "#222" }}>{NAME}</div>
          <div style={{ fontSize: 11.5, color: "#767676" }}>Springtown, TX · <span style={{ color: "#4caf50", fontWeight: 600 }}>PRO</span></div>
        </div>
        <span style={{ marginLeft: "auto", border: "1.5px solid #222", color: "#222", borderRadius: 20, padding: "4px 14px", fontSize: 12.5, fontWeight: 600 }}>Save</span>
      </div>
      <div style={{ padding: "6px 12px 14px", fontSize: 13.5, lineHeight: 1.45, color: "#222" }}><Caption text={caption} trunc={P.trunc} linkColor="#166f9c" /></div>
    </div>
  );

  // linkedin
  return (
    <div style={{ ...light, borderRadius: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 12px 8px" }}>
        <img src={AVATAR} alt="" style={{ width: 48, height: 48, borderRadius: "50%" }} />
        <div style={{ lineHeight: 1.3 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{NAME}</div>
          <div style={{ fontSize: 12, color: "#666" }}>Commercial construction · Springtown, TX</div>
          <div style={{ fontSize: 12, color: "#666" }}>Just now · 🌐</div>
        </div>
        <span style={{ marginLeft: "auto", color: "#666", fontWeight: 700, letterSpacing: 1 }}>⋯</span>
      </div>
      <div style={{ padding: "0 12px 10px", fontSize: 14, lineHeight: 1.43 }}>
        <Caption text={caption} trunc={P.trunc} more="see more" moreColor="#666" linkColor="#0a66c2" />
      </div>
      {refs.length === 0 && link ? <LinkCard link={link} aspect="1.91/1" /> : <Media refs={refs} aspect="1.91/1" />}
      <div style={{ display: "flex", borderTop: "1px solid #e8e8e8", margin: "0 8px", padding: "2px 0" }}>
        {[[ICON.liLike, "Like"], [ICON.liComment, "Comment"], [ICON.liRepost, "Repost"], [ICON.liSend, "Send"]].map(([ic, l]) => (
          <span key={l} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "10px 0", color: "#666", fontSize: 13.5, fontWeight: 600 }}>
            <I d={ic} size={16} color="#666" />{l}
          </span>
        ))}
      </div>
    </div>
  );
}

// Drag-to-arrange photo strip (Jake, 8/23: "drag around vs arrow buttons").
// Pointer events so it works on desktop AND phone; a <6px pointer travel is a TAP
// (toggle include), beyond that it's a DRAG (live reorder; dragging an excluded
// photo into the strip includes it at the drop position). First photo = cover.
function PhotoStrip({ effRefs, allRefs, onToggle, onPlace, coverBadge = true }) {
  // Drag = arrange (first photo IS the cover). Remove = explicit ✕. Excluded
  // photos sit in their own labeled row below — nothing reflows under a click.
  const [dragging, setDragging] = useState(null);
  const st = React.useRef({ file: null, sx: 0, sy: 0, moved: false, last: null });

  const down = (e, f) => {
    st.current = { file: f, sx: e.clientX, sy: e.clientY, moved: false, last: null };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    const d = st.current;
    if (!d.file) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
    if (!d.moved) { d.moved = true; setDragging(d.file); }
    const el = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.dataset?.photo && x.dataset.photo !== d.file);
    const target = el?.dataset.photo;
    if (target && target !== d.last) { d.last = target; onPlace(d.file, target); }
  };
  const up = () => { st.current = { file: null, sx: 0, sy: 0, moved: false, last: null }; setDragging(null); };

  const excluded = allRefs.filter(f => !effRefs.includes(f));
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
        {effRefs.map((f, idx) => {
          const isDrag = dragging === f;
          return (
            <div key={f} data-photo={f} onPointerDown={(e) => down(e, f)}
              style={{ position: "relative", width: 74, height: 74, touchAction: "none", cursor: "grab",
                       transform: isDrag ? "scale(1.08)" : "none", zIndex: isDrag ? 5 : 1, transition: isDrag ? "none" : "transform .12s" }}>
              <img src={`/api/media/thumb?rel=${encodeURIComponent(f)}`} alt="" draggable={false} data-photo={f}
                style={{ width: 74, height: 74, objectFit: "cover", borderRadius: 8, display: "block", pointerEvents: "none",
                         border: `2px solid ${idx === 0 ? BRAND.focus : BRAND.border}`,
                         boxShadow: isDrag ? "0 6px 18px rgba(0,0,0,.5)" : "none" }} />
              {coverBadge && idx === 0 &&
                <span style={{ position: "absolute", top: 2, left: 2, background: BRAND.focus, color: "#0C1017", fontSize: 9, fontWeight: 700, borderRadius: 4, padding: "1px 4px", pointerEvents: "none" }}>COVER</span>}
              <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onToggle(f)} title="Remove from this platform"
                style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", border: `1px solid ${C.border}`,
                         background: C.card, color: C.text, fontSize: 11, lineHeight: "15px", cursor: "pointer", padding: 0 }}>✕</button>
            </div>
          );
        })}
        {effRefs.length === 0 && <span style={{ fontSize: 12, color: C.dim }}>No photos on this platform.</span>}
      </div>
      {excluded.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>Not included — tap to add:</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {excluded.map(f => (
              <img key={f} src={`/api/media/thumb?rel=${encodeURIComponent(f)}`} alt="" onClick={() => onToggle(f)}
                style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 6, cursor: "pointer",
                         border: `1px dashed ${C.border}`, opacity: 0.45, filter: "grayscale(60%)" }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PostBuilder() {
  const [caption, setCaption] = useState("");
  const [overrides, setOverrides] = useState({});
  const [tab, setTab] = useState("facebook");
  const [placement, setPlacement] = useState("Desktop feed");
  const [on, setOn] = useState({ facebook: true, instagram: true, gbp: true, x: false, pinterest: false, linkedin: false, youtube: false, houzz: false });
  const [recent, setRecent] = useState([]);
  const [refs, setRefs] = useState([]);
  const [queued, setQueued] = useState(null);
  const [ideas, setIdeas] = useState(null);
  const [sugId, setSugId] = useState(null);
  const [usedIdea, setUsedIdea] = useState(null);
  // Per-platform photo arrangement (default = shared selection in shared order).
  const [refsByPlatform, setRefsByPlatform] = useState({});
  const [unfurls, setUnfurls] = useState({});

  useEffect(() => { fetch("/api/media/recent?bucket=postable&n=36").then(r => r.json()).then(d => setRecent(d.data || [])).catch(() => {}); }, []);
  useEffect(() => { setPlacement(PLATFORMS[tab].placements[0]); }, [tab]);

  const text = overrides[tab] ?? caption;
  const P = PLATFORMS[tab];
  const warns = lint(text, tab);
  const activePlatforms = Object.keys(on).filter(k => on[k]);

  const urlInText = (text.match(/https?:\/\/[^\s]+/) || [null])[0];
  useEffect(() => {
    if (!urlInText || unfurls[urlInText] !== undefined) return;
    const t = setTimeout(() => {
      fetch(`/api/media/unfurl?url=${encodeURIComponent(urlInText)}`)
        .then(r => r.json())
        .then(d => setUnfurls(u => ({ ...u, [urlInText]: d.ok ? d.data : false })))
        .catch(() => setUnfurls(u => ({ ...u, [urlInText]: false })));
    }, 600);
    return () => clearTimeout(t);
  }, [urlInText, unfurls]);
  const link = urlInText ? (unfurls[urlInText] || null) : null;

  const effRefs = refsByPlatform[tab] ?? refs;
  const customized = refsByPlatform[tab] !== undefined;
  const editRefs = (fn) => setRefsByPlatform(o => ({ ...o, [tab]: fn([...(o[tab] ?? refs)]) }));
  const togglePhoto = (f) => editRefs(l => l.includes(f) ? l.filter(x => x !== f) : [...l, f]);
  const placePhoto = (f, target) => editRefs(l => {
    // Direction-aware: dragging RIGHT (item was before the target) must land
    // AFTER the target — inserting before it recreates the same order (the
    // "middle photo won't move right" bug). Dragging left inserts before.
    const from = l.indexOf(f);
    const without = l.filter(x => x !== f);
    let ti = without.indexOf(target);
    if (ti < 0) return l.includes(f) ? l : [...l, f];
    if (from >= 0 && from <= l.indexOf(target)) ti += 1;
    without.splice(ti, 0, f);
    return without;
  });

  const suggest = async () => {
    setIdeas([]);
    try {
      const r = await fetch("/api/media/suggest", { method: "POST" });
      const d = await r.json();
      if (d.ok) { setIdeas(d.data.ideas); setSugId(d.data.id); } else setIdeas(null);
    } catch { setIdeas(null); }
  };
  const fb = (body) => fetch("/api/media/suggest/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const applyIdea = (idea) => {
    setCaption(idea.caption);
    setRefs(idea.photos.map(p => p.file));
    setOn(o => Object.fromEntries(Object.keys(o).map(k => [k, idea.platforms.includes(k)])));
    setRefsByPlatform({});
    setUsedIdea({ angle: idea.angle });
    fb({ suggestionId: sugId, angle: idea.angle, action: "used" });
    (ideas || []).filter(i => i.index !== idea.index).forEach(i => fb({ suggestionId: sugId, angle: i.angle, action: "ignored" }));
    setIdeas(null);
  };
  const queue = async () => {
    const r = await fetch("/api/media/posts", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption, overrides, platforms: activePlatforms, refs, refsByPlatform }) });
    const d = await r.json();
    if (d.ok) {
      setQueued(d.data.id);
      if (usedIdea) fb({ suggestionId: sugId, angle: usedIdea.angle, action: "queued", finalCaption: caption });
    }
  };

  const inp = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div><Link to="/media" style={{ color: BRAND.link, fontSize: 13, textDecoration: "none" }}>← media</Link>
        <h2 style={{ margin: "6px 0 0", fontSize: 18 }}>Post builder</h2></div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,1fr) minmax(300px,460px)", gap: 16, alignItems: "start" }}>
        <Section title="Compose">
          <div style={{ marginBottom: 12 }}>
            <button onClick={suggest} disabled={ideas && ideas.length === 0}
              style={{ padding: "8px 14px", background: "none", border: `1px solid ${BRAND.border}`, color: BRAND.focus, borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              {ideas && ideas.length === 0 ? "Thinking…" : "✨ Suggest 3 ideas"}
            </button>
            <span style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>AI picks captions AND photos — or build manually below.</span>
          </div>
          {ideas && ideas.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
              {ideas.map(i => (
                <div key={i.index} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, background: C.bg }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: BRAND.focus, fontWeight: 700, letterSpacing: 0.4 }}>{i.angle.toUpperCase()}</span>
                    <span style={{ fontSize: 11, color: C.dim }}>{i.platforms.join(" · ")}</span>
                    <button onClick={() => applyIdea(i)} style={{ marginLeft: "auto", padding: "5px 12px", background: BRAND.accent, color: "#0C1017", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Use this</button>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap", marginBottom: 8 }}>{i.caption}</div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {i.photos.map(p => <img key={p.label} src={`/api/media/thumb?rel=${encodeURIComponent(p.file)}`} alt={p.label} title={p.label}
                      style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: `1px solid ${C.border}` }} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
          <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={5} placeholder="Caption — shared across platforms unless overridden per tab. For YouTube the first line is the title."
            style={{ ...inp, resize: "vertical", marginBottom: 10 }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {Object.entries(PLATFORMS).map(([k, p]) => (
              <button key={k} onClick={() => setOn(o => ({ ...o, [k]: !o[k] }))}
                style={{ padding: "5px 11px", borderRadius: 16, fontSize: 12, cursor: "pointer",
                         border: `1px solid ${on[k] ? BRAND.border : C.border}`,
                         background: on[k] ? "rgba(168,149,43,.15)" : C.card, color: on[k] ? BRAND.focus : C.text }}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>Attach photos ({refs.length}):</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 5, marginBottom: 12 }}>
            {recent.map(m => {
              const sel = refs.includes(m.file);
              return <img key={m.label} src={`/api/media/thumb?rel=${encodeURIComponent(m.file)}`} alt={m.shows} title={m.shows} loading="lazy"
                onClick={() => setRefs(p => sel ? p.filter(x => x !== m.file) : [...p, m.file])}
                style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6, cursor: "pointer",
                         border: sel ? `3px solid ${BRAND.focus}` : `1px solid ${C.border}`, opacity: sel ? 1 : 0.8 }} />;
            })}
          </div>
          <button onClick={queue} disabled={!caption || !activePlatforms.length}
            style={{ padding: "9px 16px", background: BRAND.accent, color: "#0C1017", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: (!caption || !activePlatforms.length) ? 0.5 : 1 }}>
            Queue post ({activePlatforms.length} platform{activePlatforms.length === 1 ? "" : "s"})
          </button>
          {queued && <div style={{ marginTop: 8, fontSize: 12, color: BRAND.focus }}>Queued {queued} — posting runs through the existing pipelines, nothing published yet.</div>}
        </Section>

        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
            {Object.keys(PLATFORMS).map(k => {
              const active = on[k];
              return (
                <button key={k}
                  onClick={() => { if (!active) setOn(o => ({ ...o, [k]: true })); setTab(k); }}
                  title={active ? undefined : `Add ${PLATFORMS[k].label} to this post`}
                  style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: tab === k ? 700 : 400,
                           border: `1px ${active ? "solid" : "dashed"} ${tab === k ? BRAND.border : C.border}`, background: tab === k ? C.card : "none",
                           color: tab === k ? BRAND.focus : active ? C.text : C.dim, opacity: active ? 1 : 0.75 }}>
                  {active ? PLATFORMS[k].label : `+ ${PLATFORMS[k].label}`}
                </button>
              );
            })}
          </div>
          {activePlatforms.length === 0 ? <div style={{ color: C.dim, fontSize: 13 }}>Pick at least one platform.</div> : (
            <>
              {P.placements.length > 1 && (
                <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
                  {P.placements.map(pl => (
                    <button key={pl} onClick={() => setPlacement(pl)}
                      style={{ padding: "4px 10px", borderRadius: 12, fontSize: 11, cursor: "pointer",
                               border: `1px solid ${placement === pl ? BRAND.border : C.border}`,
                               background: "none", color: placement === pl ? BRAND.focus : C.dim }}>
                      {pl}
                    </button>
                  ))}
                </div>
              )}
              <Preview platform={tab} placement={placement} caption={text} refs={effRefs} link={link} />
              <div style={{ marginTop: 10, fontSize: 12, color: text.length > P.cap ? "#D96C5C" : C.dim }}>
                {text.length}/{P.cap} characters
                {(overrides[tab] !== undefined) && <button onClick={() => setOverrides(o => { const n = { ...o }; delete n[tab]; return n; })}
                  style={{ marginLeft: 8, background: "none", border: "none", color: BRAND.link, fontSize: 12, cursor: "pointer" }}>clear override</button>}
              </div>
              <textarea value={overrides[tab] ?? ""} onChange={e => setOverrides(o => ({ ...o, [tab]: e.target.value }))} rows={2}
                placeholder={`Override the caption for ${P.label} only (blank = shared caption)`}
                style={{ ...inp, resize: "vertical", marginTop: 8 }} />
              {refs.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: C.dim, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                    Photos on {P.label} {customized
                      ? <><span style={{ color: BRAND.focus }}>customized</span>
                          <button onClick={() => setRefsByPlatform(o => { const n = { ...o }; delete n[tab]; return n; })}
                            style={{ background: "none", border: "none", color: BRAND.link, fontSize: 12, cursor: "pointer", padding: 0 }}>reset to shared</button></>
                      : <span>shared — tap to include/exclude, drag to arrange (forks this platform)</span>}
                  </div>
                  <PhotoStrip effRefs={effRefs} allRefs={refs} onToggle={togglePhoto} onPlace={placePhoto} />
                </div>
              )}
              {warns.map(w => <div key={w} style={{ marginTop: 6, fontSize: 12, color: "#D9A93B" }}>⚠ {w}</div>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
