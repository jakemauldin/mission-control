// Tiny safe markdown for text the Claw and RFI files write: paragraphs, **bold**,
// *italic*, `code`, http(s) links, "- " bullets (nested by indent), "#" headings.
// Builds React elements only, never HTML strings, so nothing in the text can inject markup.
import { Fragment } from "react";
import { C, BRAND } from "../lib/colors";

const INLINE_SRC = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(https?:\/\/[^\s<)]+)|(\*[^*\s][^*\n]*?\*)/;

function inline(text, key) {
  const out = [];
  let last = 0, i = 0, m;
  // fresh regex per call: inline() recurses, and a shared /g regex would lose its place
  const re = new RegExp(INLINE_SRC.source, "g");
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0], k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k} style={{ fontFamily: "monospace", fontSize: "0.92em", background: "rgba(255,255,255,0.07)", padding: "1px 4px", borderRadius: 4 }}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (m[3]) { const mm = /^\[([^\]]+)\]\((.+)\)$/.exec(t); out.push(<a key={k} href={mm[2]} target="_blank" rel="noopener noreferrer" style={{ color: BRAND.link }}>{mm[1]}</a>); }
    else if (m[4]) { const url = t.replace(/[.,;:!?]+$/, ""); out.push(<a key={k} href={url} target="_blank" rel="noopener noreferrer" style={{ color: BRAND.link, wordBreak: "break-all" }}>{url}</a>); if (url.length < t.length) out.push(t.slice(url.length)); }
    else out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Paragraph text keeps single newlines as line breaks.
const lines = (txt, key) => txt.split("\n").map((l, i, a) => <Fragment key={`${key}-${i}`}>{inline(l, `${key}-${i}`)}{i < a.length - 1 && <br />}</Fragment>);

export default function Md({ text, style, size }) {
  if (!text) return null;
  const rows = String(text).replace(/\r/g, "").split("\n");
  const blocks = [];
  let para = [], list = [];
  const flushPara = () => { if (para.length) { blocks.push({ t: "p", text: para.join("\n") }); para = []; } };
  const flushList = () => { if (list.length) { blocks.push({ t: "ul", items: list }); list = []; } };
  for (const raw of rows) {
    const b = /^(\s*)[-*]\s+(.*)$/.exec(raw);
    const h = /^\s*(#{1,6})\s+(.*)$/.exec(raw);
    if (b) { flushPara(); list.push({ depth: Math.min(3, Math.floor(b[1].replace(/\t/g, "  ").length / 2)), text: b[2] }); }
    else if (h) { flushPara(); flushList(); blocks.push({ t: "h", text: h[2] }); }
    else if (!raw.trim()) { flushPara(); flushList(); }
    else if (list.length && /^\s+\S/.test(raw)) list[list.length - 1].text += " " + raw.trim();   // wrapped bullet
    else { flushList(); para.push(raw); }
  }
  flushPara(); flushList();
  return (
    <div style={{ fontSize: size || "inherit", lineHeight: 1.55, overflowWrap: "anywhere", ...style }}>
      {blocks.map((bl, i) => bl.t === "p"
        ? <p key={i} style={{ margin: i ? "6px 0 0" : 0 }}>{lines(bl.text, i)}</p>
        : bl.t === "h"
          ? <div key={i} style={{ margin: i ? "10px 0 0" : 0, fontWeight: 700, color: C.bright }}>{inline(bl.text, `h${i}`)}</div>
          : <ul key={i} style={{ margin: i ? "6px 0 0" : 0, padding: 0, listStyle: "none" }}>
              {bl.items.map((it, j) => (
                <li key={j} style={{ display: "flex", gap: 8, paddingLeft: it.depth * 16, marginTop: j ? 3 : 0 }}>
                  <span style={{ color: C.dim, flexShrink: 0 }}>•</span><span style={{ minWidth: 0 }}>{inline(it.text, `l${i}-${j}`)}</span>
                </li>
              ))}
            </ul>)}
    </div>
  );
}
