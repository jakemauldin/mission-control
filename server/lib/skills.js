// Skills (2026-08-23): every SKILL.md an agent on this box can load, in one place, grouped
// by the area that loads it — read, edit, compose, and deploy to the areas where it belongs
// (Jake: "bring the skills for each area to one spot ... build skills right on the dashboard
// and disburse them to the area they would be deployed").
//
// Areas are verified roots, not guesses (the running system is the truth):
//   claude-code   ~/services/claude-skills/<name>/SKILL.md is the git source of truth;
//                 ~/.claude/skills/<name> is the symlink Claude Code discovers. Four older
//                 skills (ask-jake, doc-to-markdown, lien-waiver, watch-video) predate the
//                 git dir and live only in ~/.claude/skills — shown as "local only".
//   paperclip     the paperclip container runs Claude Code with HOME=/paperclip, a bind
//                 mount of ~/services/paperclip-data, so its user skills live at
//                 ~/services/paperclip-data/.claude/skills (empty today). The host ~/.claude
//                 is also mounted there read-only, but at /home/node/.claude — not HOME — so
//                 host skills do NOT reach Paperclip agents; deploying here does.
//   claw          the openclaw container's main agent: /home/node/.openclaw/workspace/skills
//                 (docker volume, unreadable from the host — every read/write is
//                 `docker exec`; the container is never restarted).
//   claw-<agent>  per-agent workspaces from openclaw.json agents.list:
//                 /home/node/.openclaw/agents/<id>/workspace/skills (empty today).
//   claw-bundled  /app/skills inside the container (51, read-only, gated by
//                 openclaw.json skills.entries[<name>].enabled).
//   anthropic     the anthropic-skills plugin the Claude app pushes per session into
//                 ~/.claude/remote/plugins/<hash>/skills (read-only; newest copy shown).
//
// Every write: name is kebab-case (no path pieces possible), the target is resolved and
// checked to stay under its root, the file is written tmp+rename (host) or cat>tmp && mv
// inside the container as `node`, and claude-code saves commit in ~/services. All process
// work is async execFile — a sync docker call froze this API once (see docker.js).
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { join, resolve, dirname, sep, posix, relative } from "path";
import { homedir } from "os";
import { createHash, randomBytes } from "crypto";
import { Buffer } from "buffer";
import process from "process";

const HOME = homedir();
const SERVICES = join(HOME, "services");
const CC_SOURCE = join(SERVICES, "claude-skills");
const CC_LINKS = join(HOME, ".claude", "skills");
const PAPERCLIP_ROOT = join(SERVICES, "paperclip-data", ".claude", "skills");
const REMOTE_PLUGINS = join(HOME, ".claude", "remote", "plugins");
const CONTAINER = process.env.OPENCLAW_CONTAINER || "openclaw";
const CLAW_WS = "/home/node/.openclaw/workspace";
const CLAW_AGENTS = ["content", "leads", "analytics", "ops"];
const CLAW_BUNDLED = "/app/skills";

const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_BYTES = 512 * 1024;
const LIST_CACHE_MS = 10_000;
const DOCKER_TIMEOUT = 20_000;

const tilde = (p) => (p.startsWith(HOME + "/") ? "~" + p.slice(HOME.length) : p);

export const AREAS = [
  {
    id: "claude-code", label: "Claude Code (host)", kind: "claude-code", writable: true,
    root: CC_SOURCE, displayRoot: `${tilde(CC_SOURCE)}/<name> (git) → ${tilde(CC_LINKS)}/<name> symlink`,
    note: "Saves commit in ~/services. Also what the Telegram-revived sessions see.",
  },
  {
    id: "paperclip", label: "Paperclip agents", kind: "host", writable: true,
    root: PAPERCLIP_ROOT, displayRoot: `${tilde(PAPERCLIP_ROOT)} (= /paperclip/.claude/skills in the container)`,
    note: "Paperclip runs Claude Code with HOME=/paperclip, so host skills do not reach it — only what is deployed here.",
  },
  {
    id: "claw", label: "The Claw (main agent)", kind: "docker", writable: true,
    root: `${CLAW_WS}/skills`, displayRoot: `${CONTAINER}:${CLAW_WS}/skills`,
    note: "Workspace skills inside the openclaw container (docker volume, written via docker exec as node).",
  },
  ...CLAW_AGENTS.map((a) => ({
    id: `claw-${a}`, label: `The Claw · ${a} agent`, kind: "docker", writable: true,
    root: `/home/node/.openclaw/agents/${a}/workspace/skills`,
    displayRoot: `${CONTAINER}:/home/node/.openclaw/agents/${a}/workspace/skills`,
    note: `Per-agent workspace for the "${a}" agent (openclaw.json agents.list).`,
  })),
  {
    id: "claw-bundled", label: "The Claw · bundled (read-only)", kind: "docker", writable: false, collapsed: true,
    root: CLAW_BUNDLED, displayRoot: `${CONTAINER}:${CLAW_BUNDLED}`,
    note: "Ships with the OpenClaw image. On/off is openclaw.json skills.entries — not editable here.",
  },
  {
    id: "anthropic", label: "anthropic-skills plugin (read-only)", kind: "plugin", writable: false,
    root: null, displayRoot: `${tilde(REMOTE_PLUGINS)}/<session>/skills (newest copy)`,
    note: "Pushed by the Claude app for every remote session; managed by Anthropic, not editable.",
  },
];
const AREA_BY_ID = new Map(AREAS.map((a) => [a.id, a]));

export function isSkillName(n) { return typeof n === "string" && NAME_RE.test(n); }
export function getArea(id) { return AREA_BY_ID.get(id) || null; }

// ── frontmatter ──────────────────────────────────────────────────────────────
// Tolerant YAML subset: `key: value`, quoted values, and `>-`/`>`/`|`/`|-` block scalars
// (the house skills use folded descriptions). Enough for name/description/flags.
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text || "");
  if (!m) return { meta: {}, body: text || "", hasFrontmatter: false };
  const lines = m[1].split(/\r?\n/);
  const meta = {};
  let i = 0;
  while (i < lines.length) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) { i++; continue; }
    const key = kv[1];
    let val = kv[2].trim();
    if (/^[>|][-+]?$/.test(val)) {
      const folded = val[0] === ">";
      const block = [];
      i++;
      while (i < lines.length && (lines[i].trim() === "" || /^[ \t]/.test(lines[i]))) { block.push(lines[i].replace(/^[ \t]+/, "")); i++; }
      while (block.length && block[block.length - 1] === "") block.pop();
      if (folded) {
        const out = [];
        for (const l of block) {
          if (l === "") out.push("\n");
          else if (out.length && out[out.length - 1] !== "\n") out[out.length - 1] += " " + l;
          else out.push(l);
        }
        val = out.join("").trim();
      } else val = block.join("\n");
      meta[key] = val;
      continue;
    }
    if ((val.startsWith('"') && val.endsWith('"') && val.length > 1) || (val.startsWith("'") && val.endsWith("'") && val.length > 1)) val = val.slice(1, -1);
    meta[key] = val;
    i++;
  }
  return { meta, body: text.slice(m[0].length), hasFrontmatter: true };
}

function wrap(text, width) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > width) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

// SKILL.md with the frontmatter both Claude Code and OpenClaw read. The description is
// always a folded block scalar so colons/quotes in Jake's wording never break the YAML.
export function buildSkillFile({ name, description, body }) {
  const desc = wrap(String(description).replace(/\s+/g, " ").trim(), 76).map((l) => "  " + l).join("\n");
  return `---\nname: ${name}\ndescription: >-\n${desc}\n---\n\n${String(body).replace(/\r\n/g, "\n").trim()}\n`;
}

export function validateSkillContent(name, content) {
  if (typeof content !== "string" || !content.trim()) return "content is empty";
  if (Buffer.byteLength(content) > MAX_BYTES) return `content over ${MAX_BYTES / 1024} KB`;
  const { meta, hasFrontmatter } = parseFrontmatter(content);
  if (!hasFrontmatter) return "SKILL.md must start with a --- frontmatter block (name, description)";
  if (meta.name !== name) return `frontmatter name must be "${name}" (got "${meta.name || ""}")`;
  if (!meta.description || !String(meta.description).trim()) return "frontmatter needs a description — it is the trigger the agent reads";
  return null;
}

// ── process helpers ──────────────────────────────────────────────────────────
function run(cmd, args, { stdin, timeout = DOCKER_TIMEOUT } = {}) {
  return new Promise((resolveP) => {
    const child = execFile(cmd, args, { timeout, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolveP({ ok: false, error: (stderr || "").trim() || err.message, code: err.code, stdout: stdout || "" });
      resolveP({ ok: true, stdout: stdout || "", stderr: stderr || "" });
    });
    if (stdin !== undefined) { child.stdin.on("error", () => {}); child.stdin.end(stdin); } else child.stdin?.end();
  });
}
// Binary-safe variant (tar streams for fork). utf-8 decoding would corrupt the archive.
function runBuf(cmd, args, { stdin, timeout = 60_000 } = {}) {
  return new Promise((resolveP) => {
    const child = execFile(cmd, args, { timeout, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolveP({ ok: false, error: (stderr || "").toString().trim() || err.message });
      resolveP({ ok: true, stdout });
    });
    child.stdin.on("error", () => {});
    if (stdin !== undefined) child.stdin.end(stdin); else child.stdin.end();
  });
}
const dockerExec = (args, opts) => run("docker", ["exec", ...args], opts);

const sha1 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);

// Runs inside the container as the `node` user: one exec lists every docker root at once,
// returning frontmatter text + mtime + hash per skill (full bodies are fetched on click),
// plus the bundled on/off map from openclaw.json — only that map, never the rest of the
// file (it holds tokens).
const CONTAINER_LIST_SCRIPT = `
const fs=require("fs"),p=require("path"),c=require("crypto");
const roots=process.argv.slice(1);const out={roots:{},enabled:{}};
function extras(dir,depth,acc){if(depth>2||acc.length>=20)return acc;let ents=[];try{ents=fs.readdirSync(dir,{withFileTypes:true})}catch{return acc}
for(const e of ents){if(e.name.startsWith(".")||e.name==="__pycache__"||e.name==="node_modules")continue;const f=p.join(dir,e.name);if(e.isDirectory())extras(f,depth+1,acc);else if(e.name!=="SKILL.md"||depth>0)acc.push(f)}return acc}
for(const root of roots){const r={exists:false,skills:[]};try{const st=fs.statSync(root);r.exists=st.isDirectory()}catch{}
if(r.exists){let ents=[];try{ents=fs.readdirSync(root,{withFileTypes:true})}catch(e){r.error=e.message}
for(const e of ents){if(e.name.startsWith("."))continue;const dir=p.join(root,e.name);let f=p.join(dir,"SKILL.md"),st;try{if(!fs.statSync(dir).isDirectory())continue;st=fs.statSync(f)}catch{continue}
const txt=fs.readFileSync(f,"utf8");const m=/^---\\r?\\n([\\s\\S]*?)\\r?\\n---[ \\t]*(?:\\r?\\n|$)/.exec(txt);
r.skills.push({name:e.name,path:f,mtime:st.mtimeMs,size:st.size,hash:c.createHash("sha1").update(txt).digest("hex").slice(0,12),fm:m?m[0]:"",extraFiles:extras(dir,0,[]).map(x=>p.relative(dir,x))})}}
out.roots[root]=r}
try{const cfg=JSON.parse(fs.readFileSync("/home/node/.openclaw/openclaw.json","utf8"));const en=(cfg.skills&&cfg.skills.entries)||{};for(const k of Object.keys(en))if(en[k]&&typeof en[k].enabled==="boolean")out.enabled[k]=en[k].enabled}catch{}
process.stdout.write(JSON.stringify(out));
`;

async function listDockerRoots(roots) {
  const r = await dockerExec(["-u", "node", CONTAINER, "node", "-e", CONTAINER_LIST_SCRIPT, ...roots]);
  if (!r.ok) return { error: r.error };
  try { return JSON.parse(r.stdout); } catch (e) { return { error: `bad container listing: ${e.message}` }; }
}

// ── host listing ─────────────────────────────────────────────────────────────
async function extraFiles(dir, depth = 0, acc = []) {
  if (depth > 2 || acc.length >= 20) return acc;
  let ents = [];
  try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (e.name.startsWith(".") || e.name === "__pycache__" || e.name === "node_modules") continue;
    const f = join(dir, e.name);
    if (e.isDirectory()) await extraFiles(f, depth + 1, acc);
    else if (e.name !== "SKILL.md" || depth > 0) acc.push(f);
  }
  return acc;
}

async function readSkillDir(dir, name, extra = {}) {
  const file = join(dir, "SKILL.md");
  let st;
  try { st = await fs.stat(file); } catch { return null; }
  const content = await fs.readFile(file, "utf-8");
  const { meta } = parseFrontmatter(content);
  return {
    name, path: file, displayPath: tilde(file), mtime: new Date(st.mtimeMs).toISOString(), size: st.size,
    hash: sha1(content), description: meta.description || "", meta: pickMeta(meta),
    extraFiles: (await extraFiles(dir)).map((f) => relative(dir, f)), ...extra,
  };
}

function pickMeta(meta) {
  const out = {};
  for (const k of ["argument-hint", "disable-model-invocation", "user-invocable", "version", "metadata"]) if (meta[k] !== undefined) out[k] = meta[k];
  return out;
}

async function listHostRoot(root) {
  let ents;
  try { ents = await fs.readdir(root, { withFileTypes: true }); } catch (e) { return { exists: false, skills: [], error: e.code === "ENOENT" ? null : e.message }; }
  const skills = [];
  for (const e of ents) {
    if (e.name.startsWith(".")) continue;
    const dir = join(root, e.name);
    try { if (!(await fs.stat(dir)).isDirectory()) continue; } catch { continue; }
    const s = await readSkillDir(dir, e.name);
    if (s) skills.push(s);
  }
  return { exists: true, skills };
}

// Claude Code: union of what is linked (~/.claude/skills) and what is in git (~/services/claude-skills).
async function listClaudeCode() {
  const skills = [];
  const seen = new Set();
  let links = [];
  try { links = await fs.readdir(CC_LINKS, { withFileTypes: true }); } catch { /* no ~/.claude/skills */ }
  for (const e of links) {
    if (e.name.startsWith(".")) continue;
    const linkPath = join(CC_LINKS, e.name);
    let lst;
    try { lst = await fs.lstat(linkPath); } catch { continue; }
    let dir = linkPath, source = "local", target = null;
    if (lst.isSymbolicLink()) {
      try { target = await fs.realpath(linkPath); } catch { skills.push({ name: e.name, path: linkPath, displayPath: tilde(linkPath), broken: true, source: "broken", description: "", flags: ["broken link"] }); seen.add(e.name); continue; }
      dir = target;
      source = target.startsWith(CC_SOURCE + sep) ? "git" : "link";
    } else if (!lst.isDirectory()) continue;
    const s = await readSkillDir(dir, e.name, { source, linked: true });
    if (!s) continue;
    s.flags = source === "git" ? ["git"] : source === "link" ? [`→ ${tilde(target)}`] : ["local only"];
    skills.push(s);
    seen.add(e.name);
  }
  let src = [];
  try { src = await fs.readdir(CC_SOURCE, { withFileTypes: true }); } catch { /* no git dir */ }
  for (const e of src) {
    if (e.name.startsWith(".") || seen.has(e.name) || !e.isDirectory()) continue;
    const s = await readSkillDir(join(CC_SOURCE, e.name), e.name, { source: "git", linked: false });
    if (s) { s.flags = ["git", "not linked"]; skills.push(s); }
  }
  return { exists: true, skills };
}

// Newest remote-plugin copy named anthropic-skills. 650 copies exist (one per app
// session); resolved at most every 10 minutes.
let pluginCache = { at: 0, dir: null };
async function anthropicPluginDir() {
  if (Date.now() - pluginCache.at < 600_000) return pluginCache.dir;
  let dir = null;
  try {
    const ents = await fs.readdir(REMOTE_PLUGINS, { withFileTypes: true });
    const stats = [];
    for (const e of ents) if (e.isDirectory()) { try { stats.push({ name: e.name, mtime: (await fs.stat(join(REMOTE_PLUGINS, e.name))).mtimeMs }); } catch { /* gone */ } }
    stats.sort((a, b) => b.mtime - a.mtime);
    for (const s of stats.slice(0, 40)) {
      try {
        const pj = JSON.parse(await fs.readFile(join(REMOTE_PLUGINS, s.name, ".claude-plugin", "plugin.json"), "utf-8"));
        if (pj.name === "anthropic-skills") { dir = join(REMOTE_PLUGINS, s.name); break; }
      } catch { /* not a plugin dir */ }
    }
  } catch { /* no remote plugins */ }
  pluginCache = { at: Date.now(), dir };
  return dir;
}

// ── list (cached) ────────────────────────────────────────────────────────────
let listCache = { at: 0, data: null };
export function invalidateSkills() { listCache = { at: 0, data: null }; }

export async function listSkills() {
  if (listCache.data && Date.now() - listCache.at < LIST_CACHE_MS) return listCache.data;
  const dockerAreas = AREAS.filter((a) => a.kind === "docker");
  const [cc, pc, dk, pluginDir] = await Promise.all([
    listClaudeCode(), listHostRoot(PAPERCLIP_ROOT), listDockerRoots(dockerAreas.map((a) => a.root)), anthropicPluginDir(),
  ]);
  const plugin = pluginDir ? await listHostRoot(join(pluginDir, "skills")) : { exists: false, skills: [] };
  const areas = [];
  for (const a of AREAS) {
    const out = { id: a.id, label: a.label, kind: a.kind, writable: a.writable, collapsed: !!a.collapsed, root: a.displayRoot, note: a.note, skills: [], exists: true, error: null };
    if (a.kind === "claude-code") Object.assign(out, cc);
    else if (a.id === "paperclip") Object.assign(out, pc);
    else if (a.kind === "plugin") { Object.assign(out, plugin); out.root = pluginDir ? tilde(join(pluginDir, "skills")) : a.displayRoot; if (!pluginDir) out.error = "no anthropic-skills plugin copy found under ~/.claude/remote/plugins"; }
    else if (a.kind === "docker") {
      if (dk.error) { out.error = dk.error; out.exists = false; }
      else {
        const r = dk.roots?.[a.root] || { exists: false, skills: [] };
        out.exists = r.exists; out.error = r.error || null;
        out.skills = r.skills.map((s) => {
          const { meta } = parseFrontmatter(s.fm);
          const flags = [];
          if (a.id === "claw-bundled" && dk.enabled?.[s.name] === false) flags.push("off");
          return { name: s.name, path: s.path, displayPath: `${CONTAINER}:${s.path}`, mtime: new Date(s.mtime).toISOString(), size: s.size, hash: s.hash, description: meta.description || "", meta: pickMeta(meta), extraFiles: s.extraFiles, flags };
        });
      }
    }
    out.skills.sort((x, y) => x.name.localeCompare(y.name));
    areas.push(out);
  }
  listCache = { at: Date.now(), data: areas };
  return areas;
}

// ── locate + read one ────────────────────────────────────────────────────────
function hostTarget(root, name) {
  const full = resolve(root, name, "SKILL.md");
  if (!full.startsWith(resolve(root) + sep)) throw new Error("path escapes root");
  return full;
}
function dockerTarget(root, name) {
  const full = posix.resolve(root, name, "SKILL.md");
  if (!full.startsWith(root + "/")) throw new Error("path escapes root");
  return full;
}

// Where the file for (area, name) lives. For claude-code the git dir wins; a local-only
// skill resolves to its ~/.claude/skills dir; a symlink elsewhere is followed.
async function locate(area, name) {
  if (!isSkillName(name)) throw new Error("bad skill name");
  if (area.kind === "docker") return { kind: "docker", file: dockerTarget(area.root, name) };
  if (area.kind === "plugin") {
    const dir = await anthropicPluginDir();
    if (!dir) throw new Error("plugin copy not found");
    return { kind: "host", file: hostTarget(join(dir, "skills"), name), git: false };
  }
  if (area.kind === "host") return { kind: "host", file: hostTarget(area.root, name), git: false };
  // claude-code
  const gitFile = hostTarget(CC_SOURCE, name);
  try { await fs.stat(gitFile); return { kind: "host", file: gitFile, git: true }; } catch { /* not in git dir */ }
  const linkPath = join(CC_LINKS, name);
  try {
    const lst = await fs.lstat(linkPath);
    if (lst.isSymbolicLink()) {
      const real = await fs.realpath(linkPath);
      const file = join(real, "SKILL.md");
      await fs.stat(file);
      return { kind: "host", file, git: real.startsWith(CC_SOURCE + sep) };
    }
    if (lst.isDirectory()) return { kind: "host", file: hostTarget(CC_LINKS, name), git: false, localOnly: true };
  } catch { /* fall through */ }
  return { kind: "host", file: gitFile, git: true, missing: true };
}

async function readFileAt(loc) {
  if (loc.kind === "docker") {
    const r = await dockerExec(["-u", "node", CONTAINER, "cat", loc.file]);
    if (!r.ok) return { ok: false, error: /No such file/i.test(r.error) ? "not found" : r.error };
    return { ok: true, content: r.stdout };
  }
  try { return { ok: true, content: await fs.readFile(loc.file, "utf-8") }; }
  catch (e) { return { ok: false, error: e.code === "ENOENT" ? "not found" : e.message }; }
}

export async function getSkill(areaId, name) {
  const area = getArea(areaId);
  if (!area) return { ok: false, error: "unknown area" };
  if (!isSkillName(name)) return { ok: false, error: "bad skill name" };
  const loc = await locate(area, name);
  const r = await readFileAt(loc);
  if (!r.ok) return r;
  const { meta } = parseFrontmatter(r.content);
  const display = loc.kind === "docker" ? `${CONTAINER}:${loc.file}` : tilde(loc.file);
  return { ok: true, data: { area: areaId, name, content: r.content, path: display, writable: !!area.writable, git: !!loc.git, localOnly: !!loc.localOnly, description: meta.description || "", hash: sha1(r.content) } };
}

// ── writes ───────────────────────────────────────────────────────────────────
async function writeHostAtomic(file, content) {
  await fs.mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, file);
}

async function writeDockerAtomic(file, content) {
  const dir = posix.dirname(file);
  const r = await dockerExec(["-i", "-u", "node", CONTAINER, "sh", "-c",
    'set -e; d="$1"; mkdir -p "$d"; t="$d/.SKILL.md.tmp.$$"; cat > "$t"; mv -f "$t" "$d/SKILL.md"', "sh", dir], { stdin: content });
  if (!r.ok) throw new Error(`container write failed: ${r.error}`);
}

// git in ~/services is shared with every session on the box: add + commit only the one
// path, serialized so two saves cannot race on index.lock. Commit only — push stays with
// a human session (credentials, and the house rule to review before it leaves the box).
let gitChain = Promise.resolve();
function withGit(work) {
  const p = gitChain.then(work, work);
  gitChain = p.catch(() => {});
  return p;
}
function gitCommitPath(absFile, message) {
  const rel = relative(SERVICES, absFile);
  return withGit(async () => {
    const add = await run("git", ["-C", SERVICES, "add", "--", rel], { timeout: 30_000 });
    if (!add.ok) throw new Error(`git add failed: ${add.error}`);
    const commit = await run("git", ["-C", SERVICES, "commit", "-m", message, "--", rel], { timeout: 60_000 });
    if (!commit.ok) {
      if (/nothing to commit|no changes added/i.test(commit.stdout + commit.error)) return null;
      throw new Error(`git commit failed: ${commit.error || commit.stdout}`);
    }
    const head = await run("git", ["-C", SERVICES, "rev-parse", "--short", "HEAD"], { timeout: 10_000 });
    return head.ok ? head.stdout.trim() : "committed";
  });
}

async function ensureLink(name) {
  const linkPath = join(CC_LINKS, name);
  const target = join(CC_SOURCE, name);
  await fs.mkdir(CC_LINKS, { recursive: true });
  let lst = null;
  try { lst = await fs.lstat(linkPath); } catch { /* absent */ }
  if (lst) {
    if (lst.isSymbolicLink()) {
      if ((await fs.readlink(linkPath)) === target) return "already linked";
      await fs.unlink(linkPath);
    } else throw new Error(`~/.claude/skills/${name} is a real directory (local-only skill) — move it into ~/services/claude-skills first`);
  }
  await fs.symlink(target, linkPath);
  return "linked";
}

export async function saveSkill(areaId, name, content) {
  const area = getArea(areaId);
  if (!area) return { ok: false, error: "unknown area" };
  if (!area.writable) return { ok: false, error: "this area is read-only" };
  if (!isSkillName(name)) return { ok: false, error: "bad skill name" };
  const bad = validateSkillContent(name, content);
  if (bad) return { ok: false, error: bad };
  const loc = await locate(area, name);
  if (loc.missing) return { ok: false, error: "skill does not exist here — create it with New skill" };
  const cur = await readFileAt(loc);
  if (!cur.ok) return { ok: false, error: cur.error };
  const normalized = content.replace(/\r\n/g, "\n");
  if (cur.content === normalized) return { ok: true, message: "No changes", unchanged: true };
  if (loc.kind === "docker") await writeDockerAtomic(loc.file, normalized); else await writeHostAtomic(loc.file, normalized);
  invalidateSkills();
  let commit = null;
  if (loc.git) {
    try { commit = await gitCommitPath(loc.file, `skill: ${name} edited from dashboard`); }
    catch (e) { return { ok: true, message: `Saved, but the git commit failed: ${e.message}`, commit: null }; }
  }
  const where = loc.kind === "docker" ? `${CONTAINER}:${loc.file}` : tilde(loc.file);
  const msg = loc.git ? `Saved and committed${commit ? ` (${commit})` : ""} in ~/services` : loc.localOnly ? "Saved (local-only skill, not in git)" : `Saved to ${where}`;
  return { ok: true, message: msg, commit, hash: sha1(normalized) };
}

// Deploy `content` for `name` into one writable area. Refuses to overwrite unless asked.
async function deployTo(area, name, content, { overwrite = false, commitMessage } = {}) {
  if (!area.writable) return { area: area.id, ok: false, error: "read-only area" };
  const loc = await locate(area, name);
  const existing = await readFileAt(loc);
  if (existing.ok && !overwrite) return { area: area.id, ok: false, error: "already exists here", exists: true };
  if (existing.ok && existing.content === content) return { area: area.id, ok: true, message: "already identical", path: loc.file };
  const file = area.kind === "claude-code" ? hostTarget(CC_SOURCE, name) : loc.file;
  if (area.kind === "claude-code" && loc.localOnly) return { area: area.id, ok: false, error: `a local-only skill named ${name} already lives in ~/.claude/skills` };
  if (loc.kind === "docker") await writeDockerAtomic(file, content); else await writeHostAtomic(file, content);
  const result = { area: area.id, ok: true, path: loc.kind === "docker" ? `${CONTAINER}:${file}` : tilde(file) };
  if (area.kind === "claude-code") {
    try { result.link = await ensureLink(name); } catch (e) { result.linkError = e.message; }
    try { result.commit = await gitCommitPath(file, commitMessage || `skill: ${name} created from dashboard`); }
    catch (e) { result.commitError = e.message; }
  }
  return result;
}

export async function createSkill({ name, description, body, areas, overwrite = false }) {
  if (!isSkillName(name)) return { ok: false, error: "name must be kebab-case: lowercase letters, digits, single dashes (e.g. lien-waiver)" };
  if (!description || !String(description).trim()) return { ok: false, error: "description is required — it is what triggers the skill" };
  if (!body || !String(body).trim()) return { ok: false, error: "body is required" };
  const targets = (Array.isArray(areas) ? areas : []).map(getArea).filter((a) => a && a.writable);
  if (!targets.length) return { ok: false, error: "pick at least one area to deploy to" };
  const content = buildSkillFile({ name, description, body });
  const bad = validateSkillContent(name, content);
  if (bad) return { ok: false, error: bad };
  const results = [];
  for (const a of targets) {
    try { results.push(await deployTo(a, name, content, { overwrite })); }
    catch (e) { results.push({ area: a.id, ok: false, error: e.message }); }
  }
  invalidateSkills();
  return { ok: results.some((r) => r.ok), results, content };
}

// Copy an existing skill's SKILL.md into other areas (the "disburse" half of the ask).
export async function copySkill(fromAreaId, name, toAreaIds, { overwrite = false } = {}) {
  const src = await getSkill(fromAreaId, name);
  if (!src.ok) return src;
  const targets = (Array.isArray(toAreaIds) ? toAreaIds : []).map(getArea).filter((a) => a && a.writable && a.id !== fromAreaId);
  if (!targets.length) return { ok: false, error: "pick at least one other writable area" };
  const results = [];
  for (const a of targets) {
    try { results.push(await deployTo(a, name, src.data.content, { overwrite, commitMessage: `skill: ${name} copied from ${fromAreaId} via dashboard` })); }
    catch (e) { results.push({ area: a.id, ok: false, error: e.message }); }
  }
  invalidateSkills();
  return { ok: results.some((r) => r.ok), results };
}

// ── delete ───────────────────────────────────────────────────────────────────
// Nothing is ever rm -rf'd. Git-tracked skills are `git rm` + commit (history is the
// safety net); everything else is renamed into a sibling `skills-trash/` folder — outside
// the skills root, so no loader can rediscover it — with a timestamp for hand-recovery.
const trashStamp = () => new Date().toISOString().slice(0, 19).replace(/:/g, "-");

export async function deleteSkill(areaId, name) {
  const area = getArea(areaId);
  if (!area) return { ok: false, error: "unknown area" };
  if (!area.writable) return { ok: false, error: "this area is read-only" };
  if (!isSkillName(name)) return { ok: false, error: "bad skill name" };
  const loc = await locate(area, name);
  const existing = await readFileAt(loc);
  if (!existing.ok) return { ok: false, error: "not found" };
  invalidateSkills();

  if (loc.kind === "docker") {
    const dir = posix.dirname(loc.file);
    const trash = posix.join(posix.dirname(area.root), "skills-trash", `${name}-${trashStamp()}`);
    const r = await dockerExec(["-u", "node", CONTAINER, "sh", "-c",
      'set -e; mkdir -p "$(dirname "$2")"; mv "$1" "$2"', "sh", dir, trash]);
    if (!r.ok) return { ok: false, error: `container delete failed: ${r.error}` };
    return { ok: true, message: `Moved to ${CONTAINER}:${trash}` };
  }

  const dir = dirname(loc.file);
  if (area.kind === "claude-code") {
    if (loc.git) {
      // drop the ~/.claude/skills symlink first, then git rm + commit
      try {
        const lst = await fs.lstat(join(CC_LINKS, name));
        if (lst.isSymbolicLink()) await fs.unlink(join(CC_LINKS, name));
      } catch { /* no link */ }
      try {
        const commit = await withGit(async () => {
          const rm = await run("git", ["-C", SERVICES, "rm", "-r", "-q", "--", relative(SERVICES, dir)], { timeout: 30_000 });
          if (!rm.ok) throw new Error(`git rm failed: ${rm.error}`);
          const c = await run("git", ["-C", SERVICES, "commit", "-m", `skill: ${name} removed from dashboard`, "--", relative(SERVICES, dir)], { timeout: 60_000 });
          if (!c.ok) throw new Error(`git commit failed: ${c.error || c.stdout}`);
          const head = await run("git", ["-C", SERVICES, "rev-parse", "--short", "HEAD"], { timeout: 10_000 });
          return head.ok ? head.stdout.trim() : "committed";
        });
        await fs.rm(dir, { recursive: true, force: true }); // leftovers git never tracked (__pycache__ etc.)
        return { ok: true, message: `Removed, unlinked, committed (${commit}) — git history keeps it`, commit };
      } catch (e) { return { ok: false, error: e.message }; }
    }
    if (loc.localOnly) {
      const trash = join(dirname(CC_LINKS), "skills-trash", `${name}-${trashStamp()}`);
      await fs.mkdir(dirname(trash), { recursive: true });
      await fs.rename(dir, trash);
      return { ok: true, message: `Moved to ${tilde(trash)} (local-only skill, not in git — recover by moving it back)` };
    }
    // symlink pointing outside the git dir: removing it from this area = removing the link
    try {
      const lst = await fs.lstat(join(CC_LINKS, name));
      if (lst.isSymbolicLink()) { await fs.unlink(join(CC_LINKS, name)); return { ok: true, message: `Unlinked ~/.claude/skills/${name} (its target was left untouched)` }; }
    } catch { /* fall through */ }
    return { ok: false, error: "could not resolve what to delete" };
  }

  // plain host area (paperclip)
  const trash = join(dirname(area.root), "skills-trash", `${name}-${trashStamp()}`);
  await fs.mkdir(dirname(trash), { recursive: true });
  await fs.rename(dir, trash);
  return { ok: true, message: `Moved to ${tilde(trash)}` };
}

// ── fork to host ─────────────────────────────────────────────────────────────
// The whole skill folder (scripts, references — docx is 60 files), not just SKILL.md,
// copied into ~/services/claude-skills/<newName>, symlinked, committed. This is how a
// read-only plugin or bundled skill becomes an editable, git-tracked host skill. The
// frontmatter name is rewritten when forking under a new name. Caveats stay with the
// owner: Anthropic keeps updating the plugin original (the list's hash compare shows
// "differs"), and scripts still need their runtime deps wherever the fork is deployed.
export async function forkSkill(fromAreaId, name, newNameRaw) {
  const area = getArea(fromAreaId);
  if (!area) return { ok: false, error: "unknown area" };
  if (area.kind === "claude-code") return { ok: false, error: "already a host skill — use Copy to for other areas" };
  if (!isSkillName(name)) return { ok: false, error: "bad skill name" };
  const newName = String(newNameRaw || name).trim();
  if (!isSkillName(newName)) return { ok: false, error: "new name must be kebab-case: lowercase letters, digits, single dashes" };
  const dstDir = join(CC_SOURCE, newName);
  try { await fs.stat(dstDir); return { ok: false, error: `~/services/claude-skills/${newName} already exists` }; } catch { /* good */ }
  try { await fs.lstat(join(CC_LINKS, newName)); return { ok: false, error: `~/.claude/skills/${newName} already exists — pick another name` }; } catch { /* good */ }

  const staging = join(CC_SOURCE, `.fork-${process.pid}-${randomBytes(3).toString("hex")}`);
  try {
    await fs.mkdir(staging, { recursive: true });
    if (area.kind === "docker") {
      const t = await runBuf("docker", ["exec", "-u", "node", CONTAINER, "tar", "-C", area.root,
        "--exclude=__pycache__", "--exclude=node_modules", "--exclude=.git", "-cf", "-", name]);
      if (!t.ok) return { ok: false, error: `container read failed: ${t.error}` };
      const x = await runBuf("tar", ["-xf", "-", "-C", staging], { stdin: t.stdout });
      if (!x.ok) return { ok: false, error: `unpack failed: ${x.error}` };
    } else {
      const loc = await locate(area, name);
      const srcDir = dirname(loc.file);
      await fs.stat(join(srcDir, "SKILL.md"));
      await fs.cp(srcDir, join(staging, name), {
        recursive: true,
        filter: (src) => !/(^|\/)(__pycache__|node_modules|\.git)(\/|$)/.test(src),
      });
    }
    const stagedSkill = join(staging, name);
    let content = await fs.readFile(join(stagedSkill, "SKILL.md"), "utf-8");
    const { meta, hasFrontmatter } = parseFrontmatter(content);
    if (!hasFrontmatter) return { ok: false, error: "source SKILL.md has no frontmatter" };
    if (meta.name !== newName) content = content.replace(/^name:.*$/m, `name: ${newName}`);
    const bad = validateSkillContent(newName, content);
    if (bad) return { ok: false, error: `after rename: ${bad}` };
    await writeHostAtomic(join(stagedSkill, "SKILL.md"), content);
    await fs.rename(stagedSkill, dstDir);
    const files = (await extraFiles(dstDir)).length + 1;
    const result = { ok: true, path: tilde(join(dstDir, "SKILL.md")), files, name: newName };
    try { result.link = await ensureLink(newName); } catch (e) { result.linkError = e.message; }
    try { result.commit = await gitCommitPath(dstDir, `skill: ${newName} forked from ${fromAreaId}/${name} via dashboard`); }
    catch (e) { result.commitError = e.message; }
    invalidateSkills();
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
