// Social Post Builder v3 (Jake, 8/23): placement-level previews, modeled on Meta
// Ads Manager's "All previews" (his screen recording) — one composition rendered
// per PLACEMENT (FB desktop/mobile/story/in-stream, IG feed/story/reel, ...), not
// one generic card per platform. YouTube and Houzz added as targets. AI suggestions
// (captions + photo picks, learning loop) and true link unfurls carry over.
import { useState, useEffect } from "react";
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

function Media({ refs, aspect, single }) {
  if (!refs.length) return <div style={{ aspectRatio: aspect, background: "#22201533", display: "grid", placeItems: "center", color: C.dim, fontSize: 12 }}>no image attached</div>;
  const img = (r, st) => <img key={r} src={`/api/media/thumb?rel=${encodeURIComponent(r)}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...st }} />;
  if (single || refs.length === 1) return <div style={{ aspectRatio: aspect, overflow: "hidden" }}>{img(refs[0])}</div>;
  if (refs.length === 2) return <div style={{ aspectRatio: aspect, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>{refs.slice(0, 2).map(r => img(r))}</div>;
  return (
    <div style={{ aspectRatio: aspect, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 2 }}>
      {img(refs[0])}
      <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 2, position: "relative" }}>
        {img(refs[1])}
        <div style={{ position: "relative" }}>
          {img(refs[2])}
          {refs.length > 3 && <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center", color: "#fff", fontSize: 20, fontWeight: 600 }}>+{refs.length - 3}</div>}
        </div>
      </div>
    </div>
  );
}

function Caption({ text, trunc, dark }) {
  const t = text.length > trunc ? text.slice(0, trunc).trimEnd() : text;
  return <span style={{ whiteSpace: "pre-wrap" }}>{t}{text.length > trunc && <span style={{ color: dark ? "#8899a6" : "#65676b" }}>… See more</span>}</span>;
}

function LinkCard({ link, aspect, dark }) {
  if (!link) return null;
  const strip = { padding: "8px 12px", background: dark ? "#16181c" : "#f0f2f5", borderTop: dark ? "1px solid #2f3336" : "1px solid #ddd" };
  return (
    <div style={{ border: dark ? "1px solid #2f3336" : "1px solid #ddd", borderRadius: dark ? 14 : 0, overflow: "hidden" }}>
      {link.image
        ? <img src={link.image} alt="" style={{ width: "100%", aspectRatio: aspect, objectFit: "cover", display: "block" }} />
        : <div style={{ aspectRatio: aspect, background: dark ? "#202327" : "#e4e6eb", display: "grid", placeItems: "center" }}>
            <img src={link.icon} alt="" style={{ width: 48, height: 48 }} onError={e => { e.target.style.display = "none"; }} /></div>}
      <div style={strip}>
        <div style={{ fontSize: 11, color: dark ? "#71767b" : "#65676b", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5 }}>
          <img src={link.icon} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} onError={e => { e.target.style.display = "none"; }} />
          {link.domain}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: dark ? "#e7e9ea" : "#050505", lineHeight: 1.25, marginTop: 2 }}>{link.title}</div>
        {link.description && <div style={{ fontSize: 12, color: dark ? "#71767b" : "#65676b", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{link.description}</div>}
      </div>
    </div>
  );
}

// 9:16 fullscreen story/reel frame — the Meta preview's phone look
function StoryFrame({ caption, refs, cta, reel, handle }) {
  const bg = refs[0] ? `url(/api/media/thumb?rel=${encodeURIComponent(refs[0])})` : "linear-gradient(#3a3a2a,#111)";
  return (
    <div style={{ width: 250, aspectRatio: "9/16", borderRadius: 18, overflow: "hidden", position: "relative", background: bg, backgroundSize: "cover", backgroundPosition: "center", border: "1px solid #333", fontFamily: "Helvetica,Arial,sans-serif" }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,.45), transparent 25%, transparent 60%, rgba(0,0,0,.6))" }} />
      <div style={{ position: "absolute", top: 10, left: 10, right: 10, display: "flex", alignItems: "center", gap: 7 }}>
        {!reel && <div style={{ position: "absolute", top: -4, left: 0, right: 0, height: 2, background: "rgba(255,255,255,.35)" }}><div style={{ width: "35%", height: "100%", background: "#fff" }} /></div>}
        <img src={AVATAR} alt="" style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid rgba(255,255,255,.6)" }} />
        <span style={{ color: "#fff", fontSize: 12, fontWeight: 600, textShadow: "0 1px 2px rgba(0,0,0,.6)" }}>{handle}</span>
        <span style={{ color: "rgba(255,255,255,.7)", fontSize: 11 }}>Ad</span>
      </div>
      {reel && (
        <div style={{ position: "absolute", right: 8, bottom: 70, display: "flex", flexDirection: "column", gap: 14, color: "#fff", fontSize: 20, textAlign: "center", textShadow: "0 1px 3px rgba(0,0,0,.7)" }}>
          <span>♡</span><span>💬</span><span>➤</span><span>⋯</span>
        </div>
      )}
      <div style={{ position: "absolute", left: 10, right: reel ? 44 : 10, bottom: 44, color: "#fff", fontSize: 12, lineHeight: 1.4, textShadow: "0 1px 3px rgba(0,0,0,.8)", maxHeight: 84, overflow: "hidden" }}>
        {caption.slice(0, 140)}{caption.length > 140 ? "…" : ""}
      </div>
      <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 10, background: "#fff", color: "#050505", borderRadius: 20, padding: "7px 18px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{cta}</div>
    </div>
  );
}

function Preview({ platform, placement, caption, refs, link }) {
  const P = PLATFORMS[platform];
  const light = { background: "#fff", color: "#050505", borderRadius: 10, overflow: "hidden", maxWidth: 420, fontFamily: "Helvetica,Arial,sans-serif", border: "1px solid #d9d9d9" };
  const head = (name, sub, round = true) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px" }}>
      <img src={AVATAR} alt="" style={{ width: 38, height: 38, borderRadius: round ? "50%" : 8 }} />
      <div><div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div><div style={{ fontSize: 12, color: "#65676b" }}>{sub}</div></div>
    </div>
  );
  const bar = (items, color = "#65676b") => (
    <div style={{ display: "flex", justifyContent: "space-around", padding: "8px 0", borderTop: "1px solid #eee", color, fontSize: 13 }}>
      {items.map(i => <span key={i}>{i}</span>)}
    </div>
  );

  if (platform === "facebook") {
    if (placement === "Story") return <StoryFrame caption={caption} refs={refs} cta="Send message" handle={NAME} />;
    if (placement === "In-stream") return (
      <div style={{ ...light, background: "#000", border: "1px solid #333", maxWidth: 420 }}>
        <div style={{ aspectRatio: "16/9", position: "relative" }}>
          <Media refs={refs} aspect="16/9" single />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,.75)", padding: "8px 12px", display: "flex", gap: 8, alignItems: "center" }}>
            <img src={AVATAR} alt="" style={{ width: 26, height: 26, borderRadius: "50%" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fff", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{NAME} · Sponsored</div>
              <div style={{ color: "#b0b3b8", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{caption.slice(0, 60)}</div>
            </div>
            <span style={{ background: "#fff", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 600 }}>Send message</span>
          </div>
        </div>
      </div>
    );
    const mobile = placement === "Mobile feed";
    return (
      <div style={{ ...light, maxWidth: mobile ? 340 : 420 }}>
        {head(NAME, "Just now · 🌐")}
        <div style={{ padding: "0 12px 10px", fontSize: 14, lineHeight: 1.35 }}><Caption text={caption} trunc={P.trunc} /></div>
        {refs.length === 0 && link ? <LinkCard link={link} aspect="1.91/1" /> : <Media refs={refs} aspect={mobile ? "1/1" : "1.91/1"} />}
        {bar(["👍 Like", "💬 Comment", "↗ Share"])}
      </div>
    );
  }

  if (platform === "instagram") {
    if (placement === "Story") return <StoryFrame caption={caption} refs={refs} cta="Learn more" handle={P.handle} />;
    if (placement === "Reel") return <StoryFrame caption={caption} refs={refs} cta="Send message" handle={P.handle} reel />;
    return (
      <div style={{ ...light, maxWidth: 380 }}>
        {head(P.handle, "Original")}
        <Media refs={refs} aspect="1/1" single />
        {refs.length > 1 && <div style={{ textAlign: "center", fontSize: 10, color: "#0095f6", padding: 4 }}>{refs.map((_, i) => i === 0 ? "●" : "○").join(" ")}</div>}
        <div style={{ display: "flex", gap: 14, padding: "10px 12px 4px", fontSize: 20 }}>♡ 💬 ➤ <span style={{ marginLeft: "auto" }}>⌲</span></div>
        <div style={{ padding: "2px 12px 12px", fontSize: 14 }}><b>{P.handle}</b> <Caption text={caption} trunc={P.trunc} /></div>
      </div>
    );
  }

  if (platform === "x") return (
    <div style={{ ...light, background: "#000", color: "#e7e9ea", border: "1px solid #2f3336" }}>
      {head(NAME, `${P.handle} · now`)}
      <div style={{ padding: "0 12px 10px", fontSize: 15, lineHeight: 1.35 }}><Caption text={caption} trunc={280} dark /></div>
      {refs.length === 0 && link
        ? <div style={{ margin: "0 12px 10px" }}><LinkCard link={link} aspect="16/9" dark /></div>
        : <div style={{ margin: "0 12px 10px", borderRadius: 14, overflow: "hidden", border: "1px solid #2f3336" }}><Media refs={refs} aspect="16/9" /></div>}
      {bar(["💬 12", "🔁 4", "♡ 32", "📊 1.2K"], "#71767b")}
    </div>
  );

  if (platform === "gbp") return (
    <div style={light}>
      <Media refs={refs} aspect="4/3" single />
      {head(NAME, new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }))}
      <div style={{ padding: "0 12px 10px", fontSize: 14, lineHeight: 1.4 }}><Caption text={caption} trunc={P.trunc} /></div>
      <div style={{ padding: "0 12px 12px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#1a73e8", fontSize: 14, fontWeight: 500 }}>Learn more</span>
        {link && <span style={{ fontSize: 11, color: "#5f6368" }}>→ {link.domain}</span>}
      </div>
    </div>
  );

  if (platform === "pinterest") return (
    <div style={{ ...light, maxWidth: 260, borderRadius: 18 }}>
      <div style={{ borderRadius: "18px 18px 0 0", overflow: "hidden" }}><Media refs={refs} aspect="2/3" single /></div>
      <div style={{ padding: "10px 12px", fontSize: 14, fontWeight: 600 }}><Caption text={caption.split("\n")[0]} trunc={P.trunc} /></div>
      <div style={{ padding: "0 12px 12px", fontSize: 12, color: "#5f5f5f", display: "flex", gap: 6, alignItems: "center" }}>
        <img src={AVATAR} alt="" style={{ width: 22, height: 22, borderRadius: "50%" }} /> {NAME}
        {link && <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <img src={link.icon} alt="" style={{ width: 12, height: 12 }} onError={e => { e.target.style.display = "none"; }} />{link.domain}</span>}
      </div>
    </div>
  );

  if (platform === "youtube") {
    const [title, ...rest] = caption.split("\n");
    return (
      <div style={{ maxWidth: 380, fontFamily: "Roboto,Arial,sans-serif" }}>
        <div style={{ borderRadius: 12, overflow: "hidden", position: "relative" }}>
          <Media refs={refs} aspect="16/9" single />
          <span style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,.8)", color: "#fff", fontSize: 11, padding: "1px 5px", borderRadius: 4 }}>0:46</span>
        </div>
        <div style={{ display: "flex", gap: 10, paddingTop: 10 }}>
          <img src={AVATAR} alt="" style={{ width: 36, height: 36, borderRadius: "50%" }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.bright, lineHeight: 1.3 }}>{title.slice(0, 100) || "Video title (first caption line)"}</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{NAME} · 1.2K views · 1 hour ago</div>
            {rest.length > 0 && <div style={{ fontSize: 12, color: C.dim, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>{rest.join(" ").slice(0, 90)}</div>}
          </div>
        </div>
      </div>
    );
  }

  if (platform === "houzz") return (
    <div style={{ ...light, maxWidth: 340 }}>
      <Media refs={refs} aspect="4/3" single />
      <div style={{ padding: "10px 12px 4px", display: "flex", alignItems: "center", gap: 8 }}>
        <img src={AVATAR} alt="" style={{ width: 32, height: 32, borderRadius: 6 }} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{NAME}</div>
          <div style={{ fontSize: 11, color: "#5f5f5f" }}>★★★★★ 12 Reviews · <span style={{ color: "#2e7d32" }}>PRO</span></div>
        </div>
        <span style={{ marginLeft: "auto", border: "1px solid #2e7d32", color: "#2e7d32", borderRadius: 4, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>Save</span>
      </div>
      <div style={{ padding: "4px 12px 12px", fontSize: 13, lineHeight: 1.4, color: "#333" }}><Caption text={caption} trunc={P.trunc} /></div>
    </div>
  );

  // linkedin
  return (
    <div style={light}>
      {head(NAME, "Commercial construction · Now", false)}
      <div style={{ padding: "0 12px 10px", fontSize: 14, lineHeight: 1.4 }}><Caption text={caption} trunc={P.trunc} /></div>
      {refs.length === 0 && link ? <LinkCard link={link} aspect="1.91/1" /> : <Media refs={refs} aspect="1.91/1" />}
      {bar(["👍 Like", "💬 Comment", "🔁 Repost", "➤ Send"])}
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

  const suggest = async () => {
    setIdeas([]);
    try {
      const r = await fetch("/api/media/suggest", { method: "POST" });
      const d = await r.json();
      if (d.ok) { setIdeas(d.data.ideas); setSugId(d.data.id); } else setIdeas(null);
    } catch { setIdeas(null); }
  };
  const fb = (body) => fetch("/api/media/suggest/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const useIdea = (idea) => {
    setCaption(idea.caption);
    setRefs(idea.photos.map(p => p.file));
    setOn(o => Object.fromEntries(Object.keys(o).map(k => [k, idea.platforms.includes(k)])));
    setUsedIdea({ angle: idea.angle });
    fb({ suggestionId: sugId, angle: idea.angle, action: "used" });
    (ideas || []).filter(i => i.index !== idea.index).forEach(i => fb({ suggestionId: sugId, angle: i.angle, action: "ignored" }));
    setIdeas(null);
  };
  const queue = async () => {
    const r = await fetch("/api/media/posts", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption, overrides, platforms: activePlatforms, refs }) });
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
                    <button onClick={() => useIdea(i)} style={{ marginLeft: "auto", padding: "5px 12px", background: BRAND.accent, color: "#0C1017", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Use this</button>
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
                         background: on[k] ? "rgba(168,149,43,.15)" : "none", color: on[k] ? BRAND.focus : C.dim }}>
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
            {activePlatforms.map(k => (
              <button key={k} onClick={() => setTab(k)}
                style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: tab === k ? 700 : 400,
                         border: `1px solid ${tab === k ? BRAND.border : C.border}`, background: tab === k ? C.card : "none",
                         color: tab === k ? BRAND.focus : C.text }}>
                {PLATFORMS[k].label}
              </button>
            ))}
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
              <Preview platform={tab} placement={placement} caption={text} refs={refs} link={link} />
              <div style={{ marginTop: 10, fontSize: 12, color: text.length > P.cap ? "#D96C5C" : C.dim }}>
                {text.length}/{P.cap} characters
                {(overrides[tab] !== undefined) && <button onClick={() => setOverrides(o => { const n = { ...o }; delete n[tab]; return n; })}
                  style={{ marginLeft: 8, background: "none", border: "none", color: BRAND.link, fontSize: 12, cursor: "pointer" }}>clear override</button>}
              </div>
              <textarea value={overrides[tab] ?? ""} onChange={e => setOverrides(o => ({ ...o, [tab]: e.target.value }))} rows={2}
                placeholder={`Override the caption for ${P.label} only (blank = shared caption)`}
                style={{ ...inp, resize: "vertical", marginTop: 8 }} />
              {warns.map(w => <div key={w} style={{ marginTop: 6, fontSize: 12, color: "#D9A93B" }}>⚠ {w}</div>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
