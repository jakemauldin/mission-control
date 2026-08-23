// Social Post Builder (Jake, 8/23): compose once, preview EXACTLY as each platform
// renders it — a tab per platform, aspect crops and truncation matching that feed,
// per-platform caption overrides. Publishing itself stays with the existing
// pipelines; "Queue post" files the composition to social-post-queue/.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { C, BRAND } from "../lib/colors";
import { Section } from "../components/ui/Card";

const AVATAR = "/logo-64.png";
const NAME = "Rising Creek Construction";

// Platform facts: preview truncation, hard caption caps, preferred image aspect.
const PLATFORMS = {
  facebook:  { label: "Facebook",  trunc: 280, cap: 8000, aspect: "1.91/1", handle: NAME },
  instagram: { label: "Instagram", trunc: 125, cap: 2200, aspect: "1/1",    handle: "risingcreekconstruction" },
  gbp:       { label: "Google",    trunc: 1500, cap: 1500, aspect: "4/3",   handle: NAME },
  x:         { label: "X",         trunc: 280, cap: 280,  aspect: "16/9",   handle: "@risingcreek" },
  pinterest: { label: "Pinterest", trunc: 100, cap: 500,  aspect: "2/3",    handle: NAME },
  linkedin:  { label: "LinkedIn",  trunc: 210, cap: 3000, aspect: "1.91/1", handle: NAME },
};

// House-rule lint — these come from real Rising Creek incidents, keep them.
function lint(text, platform) {
  const warns = [];
  if (/\$\s?\d[\d,]*(\s?(?:-|–|to)\s?\$?\d[\d,]*)?/i.test(text)) warns.push("Never put project-size $ figures in public copy (house rule).");
  if (/dirt\s*to\s*done/i.test(text)) warns.push('"Dirt to Done" is a competitor\'s line — use "Built like it\'s ours."');
  if (platform === "x" && text.length > 280) warns.push(`X hard limit: ${text.length}/280 — this will not post.`);
  if (platform === "gbp" && /#\w/.test(text)) warns.push("GBP ignores hashtags — they read as clutter there.");
  if (platform === "instagram" && !/#\w/.test(text)) warns.push("Instagram reach benefits from 3-5 tags.");
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
  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      {t}{text.length > trunc && <span style={{ color: dark ? "#8899a6" : "#65676b" }}>… See more</span>}
    </span>
  );
}

// ── faithful feed cards. Light platforms render light — that IS the preview. ──
function Preview({ platform, caption, refs }) {
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

  if (platform === "facebook") return (
    <div style={light}>
      {head(NAME, "Just now · 🌐")}
      <div style={{ padding: "0 12px 10px", fontSize: 14, lineHeight: 1.35 }}><Caption text={caption} trunc={P.trunc} /></div>
      <Media refs={refs} aspect={P.aspect} />
      {bar(["👍 Like", "💬 Comment", "↗ Share"])}
    </div>
  );
  if (platform === "instagram") return (
    <div style={{ ...light, maxWidth: 380 }}>
      {head(P.handle, "Original")}
      <Media refs={refs} aspect="1/1" single />
      {refs.length > 1 && <div style={{ textAlign: "center", fontSize: 10, color: "#0095f6", padding: 4 }}>{refs.map((_, i) => i === 0 ? "●" : "○").join(" ")}</div>}
      <div style={{ display: "flex", gap: 14, padding: "10px 12px 4px", fontSize: 20 }}>♡ 💬 ➤ <span style={{ marginLeft: "auto" }}>⌲</span></div>
      <div style={{ padding: "2px 12px 12px", fontSize: 14 }}><b>{P.handle}</b> <Caption text={caption} trunc={P.trunc} /></div>
    </div>
  );
  if (platform === "x") return (
    <div style={{ ...light, background: "#000", color: "#e7e9ea", border: "1px solid #2f3336" }}>
      {head(NAME, `${P.handle} · now`)}
      <div style={{ padding: "0 12px 10px", fontSize: 15, lineHeight: 1.35 }}><Caption text={caption} trunc={280} dark /></div>
      <div style={{ margin: "0 12px 10px", borderRadius: 14, overflow: "hidden", border: "1px solid #2f3336" }}><Media refs={refs} aspect={P.aspect} /></div>
      {bar(["💬 12", "🔁 4", "♡ 32", "📊 1.2K"], "#71767b")}
    </div>
  );
  if (platform === "gbp") return (
    <div style={light}>
      <Media refs={refs} aspect={P.aspect} single />
      {head(NAME, new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }))}
      <div style={{ padding: "0 12px 10px", fontSize: 14, lineHeight: 1.4 }}><Caption text={caption} trunc={P.trunc} /></div>
      <div style={{ padding: "0 12px 12px" }}><span style={{ color: "#1a73e8", fontSize: 14, fontWeight: 500 }}>Learn more</span></div>
    </div>
  );
  if (platform === "pinterest") return (
    <div style={{ ...light, maxWidth: 260, borderRadius: 18 }}>
      <div style={{ borderRadius: "18px 18px 0 0", overflow: "hidden" }}><Media refs={refs} aspect={P.aspect} single /></div>
      <div style={{ padding: "10px 12px", fontSize: 14, fontWeight: 600 }}><Caption text={caption.split("\n")[0]} trunc={P.trunc} /></div>
      <div style={{ padding: "0 12px 12px", fontSize: 12, color: "#5f5f5f", display: "flex", gap: 6, alignItems: "center" }}>
        <img src={AVATAR} alt="" style={{ width: 22, height: 22, borderRadius: "50%" }} /> {NAME}
      </div>
    </div>
  );
  // linkedin
  return (
    <div style={light}>
      {head(NAME, "Commercial construction · Now", false)}
      <div style={{ padding: "0 12px 10px", fontSize: 14, lineHeight: 1.4 }}><Caption text={caption} trunc={P.trunc} /></div>
      <Media refs={refs} aspect={P.aspect} />
      {bar(["👍 Like", "💬 Comment", "🔁 Repost", "➤ Send"])}
    </div>
  );
}

export default function PostBuilder() {
  const [caption, setCaption] = useState("");
  const [overrides, setOverrides] = useState({});
  const [tab, setTab] = useState("facebook");
  const [on, setOn] = useState({ facebook: true, instagram: true, gbp: true, x: false, pinterest: false, linkedin: false });
  const [recent, setRecent] = useState([]);
  const [refs, setRefs] = useState([]);
  const [queued, setQueued] = useState(null);
  const [ideas, setIdeas] = useState(null);        // null = never asked, [] = loading
  const [sugId, setSugId] = useState(null);
  const [usedIdea, setUsedIdea] = useState(null);  // {angle} for the queue-time feedback loop

  useEffect(() => { fetch("/api/media/recent?bucket=postable&n=36").then(r => r.json()).then(d => setRecent(d.data || [])).catch(() => {}); }, []);

  const text = overrides[tab] ?? caption;
  const P = PLATFORMS[tab];
  const warns = lint(text, tab);
  const activePlatforms = Object.keys(on).filter(k => on[k]);

  const suggest = async () => {
    setIdeas([]);
    try {
      const r = await fetch("/api/media/suggest", { method: "POST" });
      const d = await r.json();
      if (d.ok) { setIdeas(d.data.ideas); setSugId(d.data.id); }
      else setIdeas(null);
    } catch { setIdeas(null); }
  };

  const useIdea = (idea) => {
    setCaption(idea.caption);
    setRefs(idea.photos.map(p => p.file));
    setOn(o => Object.fromEntries(Object.keys(o).map(k => [k, idea.platforms.includes(k)])));
    setUsedIdea({ angle: idea.angle });
    // feedback: this one used, the siblings ignored — the learning signal
    fetch("/api/media/suggest/feedback", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestionId: sugId, angle: idea.angle, action: "used" }) });
    (ideas || []).filter(i => i.index !== idea.index).forEach(i =>
      fetch("/api/media/suggest/feedback", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionId: sugId, angle: i.angle, action: "ignored" }) }));
    setIdeas(null);
  };

  const queue = async () => {
    const r = await fetch("/api/media/posts", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption, overrides, platforms: activePlatforms, refs }) });
    const d = await r.json();
    if (d.ok) {
      setQueued(d.data.id);
      // close the loop: the FINAL caption (Jake's edits included) is the strongest signal
      if (usedIdea) fetch("/api/media/suggest/feedback", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionId: sugId, angle: usedIdea.angle, action: "queued", finalCaption: caption }) });
    }
  };

  const inp = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div><Link to="/media" style={{ color: BRAND.link, fontSize: 13, textDecoration: "none" }}>← media</Link>
        <h2 style={{ margin: "6px 0 0", fontSize: 18 }}>Post builder</h2></div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,1fr) minmax(300px,460px)", gap: 16, alignItems: "start" }}>
        {/* ── compose ── */}
        <Section title="Compose">
          <div style={{ marginBottom: 12 }}>
            <button onClick={suggest} disabled={ideas && ideas.length === 0}
              style={{ padding: "8px 14px", background: "none", border: `1px solid ${BRAND.border}`, color: BRAND.focus, borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              {ideas && ideas.length === 0 ? "Thinking…" : "✨ Suggest 3 ideas"}
            </button>
            <span style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>AI picks captions AND photos from your graded library — or build it manually below.</span>
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
          <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={5} placeholder="Caption — shared across platforms unless overridden per tab"
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

        {/* ── preview ── */}
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
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
              <Preview platform={tab} caption={text} refs={refs} />
              <div style={{ marginTop: 10, fontSize: 12, color: text.length > P.cap ? "#D96C5C" : C.dim }}>
                {text.length}/{P.cap} characters · preferred image {P.aspect.replace("/", ":")}
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
