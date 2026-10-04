// Media read layer: counts, the postable picker, thumbnails. READ ONLY on the photo
// pipeline's files — the gallery (scripts/photo-gallery.py) owns every write.
//
// Two key schemes live side by side (see scripts/photo_keys.py): _catalogue.json is
// keyed by sequence label ("TAKEOUT 14") and holds only Jake's 3,080 hand-catalogued
// photos; _grades.json is keyed by file path and holds all ~13.7K graded photos. The
// gallery merges them, hand-catalogued rows winning. We merge the same way so counts
// and the picker agree with what he sees in the gallery.
import { readFileSync, statSync, existsSync } from "fs";
import { join } from "path";

const MEDIA = process.env.MC_MEDIA_DIR || "/mnt/rc_media/media-library/rising-creek";

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(join(MEDIA, f), "utf-8")); } catch { return fallback; } };
const readList = (f) => { const d = readJson(f, []); return Array.isArray(d) ? d : Object.keys(d || {}); };
const mtime = (f) => { try { return statSync(join(MEDIA, f)).mtimeMs; } catch { return 0; } };

// gallery_key(): label for a file path that is not hand-catalogued
const stemKey = (rel) => {
  const p = rel.split("/");
  const name = p[p.length - 1].replace(/\.[^.]+$/, "");
  return `${(p.length > 1 ? p[p.length - 2] : "LIB").toUpperCase().replace(/^_+/, "")} ${name}`;
};

let cache = { stamp: "", rows: null };
// label -> { file, shows, people, kids, shot, reference, dumped, dontUse, personal, derived }
function merged() {
  const stamp = `${mtime("_catalogue.json")}:${mtime("_grades.json")}`;
  if (cache.stamp === stamp && cache.rows) return cache.rows;
  const cat = readJson("_catalogue.json", {});
  const grades = readJson("_grades.json", null);
  const rows = new Map();
  const known = new Set();
  for (const [label, v] of Object.entries(cat)) {
    if (!v || typeof v !== "object") continue;
    if (v.file) known.add(v.file);
    rows.set(label, {
      file: v.file || "", shows: v.shows || "",
      people: !!v.people, kids: !!v.kids,
      shot: (v.flags || []).some(f => /screenshot|reference/i.test(f)),
      reference: false, dumped: !!v.dumped, dontUse: v.verdict === "dont-use",
      personal: v.bucket === "PERSONAL", job: v.bucket !== "PERSONAL" && v.bucket !== "UNCLEAR" || v.scope && !/^(n\/a|none|other)?$/i.test(v.scope.trim()),
    });
  }
  if (grades && typeof grades === "object") {
    for (const [rel, g] of Object.entries(grades)) {
      if (!g || typeof g !== "object" || Array.isArray(g) || g.error || known.has(rel) || rel.startsWith("_sheets/")) continue;
      const pd = g.people_detail || [];
      const label = stemKey(rel);
      if (rows.has(label)) continue;
      rows.set(label, {
        file: rel, shows: g.shows || "",
        people: g.people_presence !== "none" || pd.length > 0 || (g.subject || []).includes("people"),
        kids: pd.includes("kids"),
        shot: !!(g.screenshot && g.screenshot.type) || (g.subject || []).includes("document"),
        reference: !!g.reference_material, unusable: !!g.unusable,
        dumped: false, dontUse: false,   // the gallery only flags dumped on catalogue rows
        personal: g.bucket === "personal", job: g.bucket === "construction" && g.status === "ok",
        derived: rel.startsWith("_derived/"),
      });
    }
  }
  cache = { stamp, rows };
  return rows;
}

// What the gallery's sidebar counts, so the dashboard number matches the page it links to.
// "undecided" = the gallery's Unsorted tab: no decision of any kind, not dumped, not trash.
export function mediaCounts() {
  const rows = merged();
  const buckets = { approved: readList("_approved.json"), postable: readList("_postable.json"), trash: readList("_trash.json"), records: readList("_records.json"), personal: readList("_personal.json") };
  const decided = new Set(Object.values(buckets).flat());
  let undecided = 0;
  for (const [k, r] of rows) if (!decided.has(k) && !r.dumped && !r.derived && r.file) undecided++;
  return {
    catalogued: rows.size,
    undecided,
    ...Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  };
}

// Thumbnails already exist in _thumbs (gallery's cache-first scheme: key = rel path with
// non-alnum -> "_" + "_340.jpg"). We serve ONLY from the cache, never generate.
export function thumbPathFor(rel) {
  const key = String(rel).replace(/[^A-Za-z0-9]/g, "_") + "_340.jpg";
  return join(MEDIA, "_thumbs", key);
}

// Picker candidates. Privacy bug fix (audit work-6): when unsure, leave it out. A photo
// qualifies only if it is a real job photo — not from the takeout/_dump piles (phone
// dumps full of screenshots, receipts and family shots), not in personal/records/trash,
// no people or kids, no screenshot/document/reference flag, and not binned by the grader.
export function isPostableJobPhoto(label, r, blocked) {
  if (!r || !r.file || blocked.has(label)) return false;
  if (/^(_dump|takeout|_derived)\//i.test(r.file)) return false;
  if (r.dumped || r.derived || r.personal || r.people || r.kids || r.shot || r.reference || r.unusable) return false;
  if (!r.job) return false;
  if (/screenshot|text message|document|receipt|\bchat\b|conversation|selfie|child|kid|family|person|people|man |woman|worker|crew/i.test(r.shows)) return false;
  return true;
}

export function recentMedia(bucket = "postable", n = 24) {
  const listFile = { postable: "_postable.json", approved: "_approved.json" }[bucket];
  if (!listFile) return [];
  const labels = readList(listFile);
  const rows = merged();
  const blocked = new Set([...readList("_personal.json"), ...readList("_records.json"), ...readList("_trash.json")]);
  const out = [];
  for (const label of labels.slice().reverse()) {   // newest additions last in file -> reverse
    const r = rows.get(label);
    if (!isPostableJobPhoto(label, r, blocked)) continue;
    if (!existsSync(thumbPathFor(r.file))) continue;  // only show what can render
    out.push({ label, file: r.file, shows: r.shows });
    if (out.length >= n) break;
  }
  return out;
}
