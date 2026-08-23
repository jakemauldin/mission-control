// AI post suggestions (Jake, 8/23): "offer up some generated ideas that I can choose
// from or edit myself... optimized over time by looking at previous posts."
//
// Model: claude-sonnet-5 — the stack's measured default for API work (CLAUDE.md
// routing bench). Cost per click ~1-2¢. The learning loop is honest, not ML: every
// prompt carries (a) Jake's most recent QUEUED posts — his real voice, edits included —
// and (b) which past suggestions he used vs ignored, so ignored angles fade.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { listPosts } from "./posts.js";
import { thumbPathFor } from "./rfis.js";

const MEDIA = "/mnt/rc_media/media-library/rising-creek";
const LOG = join(import.meta.dirname, "..", "data", "post-suggestions.jsonl");

const IdeaSchema = z.object({
  ideas: z.array(z.object({
    caption: z.string(),
    platforms: z.array(z.enum(["facebook", "instagram", "gbp", "x", "pinterest", "linkedin"])),
    photoLabels: z.array(z.string()),
    angle: z.string(),
  })).length(3),
});

function candidates() {
  const read = (f) => { try { const d = JSON.parse(readFileSync(join(MEDIA, f), "utf-8")); return Array.isArray(d) ? d : Object.keys(d); } catch { return []; } };
  let cat = {};
  try { cat = JSON.parse(readFileSync(join(MEDIA, "_catalogue.json"), "utf-8")); } catch { return []; }
  const pool = new Set([...read("_postable.json"), ...read("_approved.json")]);
  const out = [];
  for (const label of [...pool].reverse()) {
    const e = cat[label];
    if (!e?.file || (e.quality || 0) < 6) continue;
    if (!existsSync(thumbPathFor(e.file))) continue;
    out.push({ label, shows: e.shows, scope: e.scope, stage: e.stage, quality: e.quality });
    if (out.length >= 70) break;
  }
  return out;
}

function publishedBlock() {
  // Backdated corpus: posts that actually ran on the platforms (imported via
  // scripts/import-published-posts.mjs). Engagement-sorted when metrics exist —
  // what the AUDIENCE responded to outranks recency.
  try {
    const hist = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "published-history.json"), "utf-8"));
    return hist
      .slice()
      .sort((a, b) => ((b.likes || 0) + 2 * (b.comments || 0)) - ((a.likes || 0) + 2 * (a.comments || 0)))
      .slice(0, 12);
  } catch { return []; }
}

function historyBlock() {
  const posts = listPosts().slice(0, 10).map(p => ({ caption: p.caption, platforms: p.platforms }));
  let feedback = [];
  try {
    feedback = readFileSync(LOG, "utf-8").trim().split("\n").slice(-30)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { /* first run */ }
  const used = feedback.filter(f => f.action === "used").map(f => f.angle).filter(Boolean);
  const ignored = feedback.filter(f => f.action === "ignored").map(f => f.angle).filter(Boolean);
  return { posts, used, ignored };
}

const VOICE = `You write social posts for Rising Creek Construction — an owner-run commercial
general contractor in Springtown, TX (DFW market), with a 300+ trade-partner bench. Also does
select custom homes and barndominiums. Voice: "WE", plainspoken, proud of the work, zero puffery.

HARD RULES (violations make the idea unusable):
- NEVER any dollar figures or project-size ranges.
- NEVER "Dirt to Done" (competitor's line). Ours: "Built like it's ours."
- NEVER claim tilt-wall experience. NEVER kids in ad content.
- No AI-tells: no "elevate", "seamless", "unlock", no rule-of-three sentences, no em dashes.
- Sound like a builder talking, not a marketer.`;

export async function suggestPosts() {
  const client = new Anthropic(); // ANTHROPIC_API_KEY from env (BWS via start.sh)
  const cands = candidates();
  if (!cands.length) throw new Error("no graded postable photos to work from");
  const hist = historyBlock();
  const published = publishedBlock();
  const id = `sug-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;

  const response = await client.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 3000,
    output_config: { format: zodOutputFormat(IdeaSchema), effort: "medium" },
    system: VOICE,
    messages: [{
      role: "user",
      content: `Photo library (graded; label + what it shows):
${cands.map(c => `${c.label}: ${c.shows} [${c.scope || ""} · ${c.stage || ""} · q${c.quality}]`).join("\n")}

${published.length ? `PUBLISHED posts that actually ran on the platforms (deepest voice truth; those with engagement numbers are what the audience responded to — favor their angles):
${published.map(p => `- [${p.platform}${p.likes != null ? ` · ${p.likes}👍/${p.comments}💬` : ""}] ${p.caption.slice(0, 200)}`).join("\n")}

` : ""}${hist.posts.length ? `Jake's recent REAL posts (match this voice exactly — his edits are the ground truth):
${hist.posts.map(p => `- [${p.platforms.join(",")}] ${p.caption.slice(0, 200)}`).join("\n")}` : "No post history yet — lean on the voice rules."}
${hist.used.length ? `\nAngles he has USED before (good territory): ${hist.used.slice(-5).join(" · ")}` : ""}
${hist.ignored.length ? `\nAngles he IGNORED (avoid): ${hist.ignored.slice(-8).join(" · ")}` : ""}

Propose exactly 3 post ideas. Each: a ready-to-post caption, the platforms it suits,
2-4 photoLabels chosen from the library above (pick photos that genuinely support the
caption — you are choosing the media, that is the point), and "angle": a 4-8 word label
for the idea's territory (used for the feedback loop).`,
    }],
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("model returned unparseable ideas");
  // map labels → files, drop hallucinated labels
  let cat = {};
  try { cat = JSON.parse(readFileSync(join(MEDIA, "_catalogue.json"), "utf-8")); } catch { /* */ }
  const ideas = parsed.ideas.map((i, idx) => ({
    ...i, index: idx,
    photos: i.photoLabels.map(l => cat[l]?.file ? { label: l, file: cat[l].file } : null).filter(Boolean),
  }));
  mkdirSync(join(import.meta.dirname, "..", "data"), { recursive: true });
  appendFileSync(LOG, JSON.stringify({ id, at: new Date().toISOString(), action: "shown", angles: ideas.map(i => i.angle) }) + "\n");
  return { id, ideas };
}

export function recordSuggestionFeedback({ suggestionId, angle, action, finalCaption }) {
  appendFileSync(LOG, JSON.stringify({ id: suggestionId, at: new Date().toISOString(), action, angle, finalCaption: finalCaption?.slice(0, 300) }) + "\n");
  return true;
}
