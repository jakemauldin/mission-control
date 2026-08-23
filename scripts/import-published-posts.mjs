#!/usr/bin/env node
// Backfill the post-suggestion learning corpus from ACTUALLY PUBLISHED posts
// (Jake, 8/23: "use the previous posts used on the platform to learn, backdating
// the learning"). Local marketing dirs are drafts (fb-album's own README says
// NOTHING HERE HAS BEEN PUBLISHED), so real history comes in via this importer.
//
// Accepts:
//   node scripts/import-published-posts.mjs history.csv     (Meta Business Suite export)
//   node scripts/import-published-posts.mjs posts.jsonl     ({caption, platform, date, likes?, comments?} per line)
// Appends normalized entries to server/data/published-history.json (deduped by caption hash).
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "server", "data", "published-history.json");
const src = process.argv[2];
if (!src) { console.error("usage: import-published-posts.mjs <file.csv|file.jsonl>"); process.exit(2); }

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf-8")) : [];
const seen = new Set(existing.map(e => e.hash));
const raw = readFileSync(src, "utf-8");
const rows = [];

if (src.endsWith(".jsonl")) {
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { console.warn("skip bad line"); }
  }
} else {
  // CSV: tolerate Meta's varying headers — find caption-ish, date-ish, metric-ish columns
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const parse = (l) => { const out = []; let cur = "", q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; }
    out.push(cur); return out.map(x => x.trim()); };
  const head = parse(lines[0]).map(h => h.toLowerCase());
  const col = (...names) => head.findIndex(h => names.some(n => h.includes(n)));
  const ci = { cap: col("description", "caption", "message", "post text", "text"), date: col("publish", "date", "created"),
               likes: col("reaction", "like"), comments: col("comment"), reach: col("reach", "impression") };
  if (ci.cap < 0) { console.error("no caption column found; headers:", head.join(" | ")); process.exit(1); }
  for (const l of lines.slice(1)) {
    const c = parse(l);
    if (!c[ci.cap]) continue;
    rows.push({ caption: c[ci.cap], date: ci.date >= 0 ? c[ci.date] : null, platform: "facebook",
                likes: ci.likes >= 0 ? Number(c[ci.likes]) || 0 : null,
                comments: ci.comments >= 0 ? Number(c[ci.comments]) || 0 : null,
                reach: ci.reach >= 0 ? Number(c[ci.reach]) || 0 : null });
  }
}

let added = 0;
for (const r of rows) {
  const caption = String(r.caption || "").trim();
  if (caption.length < 15) continue;                       // skip stub/photo-only posts
  const hash = createHash("sha1").update(caption).digest("hex").slice(0, 12);
  if (seen.has(hash)) continue;
  seen.add(hash);
  existing.push({ hash, caption: caption.slice(0, 600), platform: r.platform || "facebook",
                  date: r.date || null, likes: r.likes ?? null, comments: r.comments ?? null, reach: r.reach ?? null });
  added++;
}
existing.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
writeFileSync(OUT, JSON.stringify(existing, null, 2));
console.log(`imported ${added} new (total ${existing.length}) -> ${OUT}`);
