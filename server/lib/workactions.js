// workactions.js — dashboard writes routed through each work source's writer.
import { execFile as runFile } from "child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { createHash, randomBytes } from "crypto";
import { homedir } from "os";
import { dirname, join, relative } from "path";
import { getWork } from "./workitems.js";
import { loadStore, updateTodo } from "./projects.js";

const SERVICES = process.env.SERVICES_DIR || join(homedir(), "services");
const LOG = join(import.meta.dirname, "..", "data", "work-log.jsonl");
// Keep title cleaning and hashing in sync with workitems.js.
const cleanText = (s) => String(s || "").replace(/<!--.*?-->/g, "").replace(/\*\*|~~/g, "").replace(/\s+/g, " ").trim();
const todoId = (title) => `todo:${createHash("sha1").update(cleanText(title).normalize("NFKC").toLowerCase()).digest("hex").slice(0, 12)}`;
const lastLine = (s) => String(s || "").trim().split(/\r?\n/).pop();

function logAttempt(entry) {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, JSON.stringify(entry) + "\n");
}

function execute(execFile, file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf-8", ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr || error.stderr;
        reject(error);
      } else resolve(stdout);
    });
  });
}

function todoLine(servicesDir, expect) {
  const dir = join(servicesDir, "docs", "status");
  const files = readdirSync(dir).filter((file) => file.endsWith("-jake-todo.md")).map((file) => {
    const path = join(dir, file);
    const mtime = statSync(path).mtime.toISOString();
    const date = file.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    return { path, mtime, date: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : mtime };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.mtime.localeCompare(a.mtime) || b.path.localeCompare(a.path));
  for (const file of files) {
    const lines = readFileSync(file.path, "utf-8").split(/(\r?\n)/);
    const matches = [];
    for (let i = 0; i < lines.length; i += 2) {
      const match = lines[i].match(/^(\s*- \[)([ xX])(\]\s+)(.+)$/);
      if (match && cleanText(match[4]) === expect) matches.push({ index: i, match });
    }
    if (matches.length > 1) return null;
    if (matches.length === 1) return { ...file, lines, ...matches[0] };
  }
  return null;
}

export async function applyWorkAction(id, body, deps = {}) {
  const servicesDir = deps.servicesDir || SERVICES;
  const execFile = deps.execFile || runFile;
  const now = new Date((deps.now || (() => new Date()))());
  const log = deps.log || logAttempt;
  const action = typeof body?.action === "string" ? body.action : null;
  let source = null;
  let commitError;
  let result;
  const fail = (status, error) => ({ status, body: { ok: false, error } });
  try {
    const item = getWork(now).items.find((item) => item.id === id);
    source = item?.source || null;
    let text;
    if (!body || typeof body !== "object" || Array.isArray(body) || !["done", "reopen", "note", "assign"].includes(action)) {
      result = fail(400, "action must be done, reopen, note or assign");
    } else if (action === "note" && (typeof body.text !== "string" || !(text = body.text.replace(/[\r\n]+/g, " ").trim()) || text.length > 500)) {
      result = fail(400, "note text must be 1-500 characters");
    } else if (!item) {
      result = fail(404, "unknown work id");
    } else if (["backlog", "inflight"].includes(source) || (action === "assign" && source !== "apps")) {
      result = fail(422, "action not allowed for this source");
    } else if (source === "jake-todo" && (typeof body.expect !== "string" || !body.expect)) {
      result = fail(400, "expect title required for jake-todo writes");
    } else if (source === "jake-todo" && body.expect !== item.title) {
      result = fail(409, "stale work item: the line changed");
    } else {
      const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit" }).format(now);
      let rereadId = id;
      let rereadTodo;
      if (source === "projects") {
        const project = loadStore().projects.find((p) => (p.todos || []).some((todo) => `projects:${p.id}:${todo.id}` === id));
        const todo = project?.todos.find((todo) => `projects:${project.id}:${todo.id}` === id);
        const updated = todo && updateTodo(project.id, todo.id, action === "note" ? { text: `${todo.text} — note ${date}: ${text}` } : { done: action === "done" });
        if (!updated) result = fail(404, "unknown work id");
      } else if (source === "apps") {
        const apps = JSON.parse(readFileSync(join(servicesDir, "projects", "app-builds", "apps.json"), "utf-8"));
        const step = apps.flatMap((app) => app.roadmap || []).find((step) => step.id && `apps:${step.id}` === id);
        if (!step) result = fail(422, "roadmap step has no real id");
        else if (action === "assign" && !["codex", "claude"].includes(body.lane)) result = fail(400, "lane must be codex or claude");
        else {
          const args = [join(servicesDir, "scripts", "roadmap.py"), "set", String(step.id)];
          if (action === "done") args.push("--state", "done", "--note", "done from dashboard");
          if (action === "reopen") args.push("--state", "next", "--note", "reopened from dashboard");
          if (action === "note") args.push("--note", text);
          if (action === "assign") args.push("--state", "next", "--lane", body.lane, "--note", "handed off from dashboard");
          args.push("--no-refresh");
          await execute(execFile, "python3", args, { timeout: 20_000 });
        }
      } else if (source === "jake-todo") {
        const line = todoLine(servicesDir, body.expect);
        if (!line) result = fail(409, "stale work item: the line changed or is duplicated");
        else {
          let [, prefix, checked, suffix, title] = line.match;
          if (action === "done" && checked === " ") { checked = "x"; title += ` (done ${date} from dashboard)`; }
          if (action === "reopen") { checked = " "; title = title.replace(/\s+\(done [^()]* from dashboard\)\s*$/, ""); }
          if (action === "note") title += ` (note ${date}: ${text})`;
          line.lines[line.index] = `${prefix}${checked}${suffix}${title}`;
          const tmp = `${line.path}.${randomBytes(6).toString("hex")}.tmp`;
          try {
            writeFileSync(tmp, line.lines.join(""), { flag: "wx", mode: statSync(line.path).mode });
            renameSync(tmp, line.path);
          } catch (e) {
            try { unlinkSync(tmp); } catch { /* never written */ }
            throw e;
          }
          // Re-read the line even when a checked item from an old file expires from the feed.
          const updatedLine = readFileSync(line.path, "utf-8").split(/(\r?\n)/)[line.index].match(/^\s*- \[([ xX])\]\s+(.+)$/);
          const updatedTitle = cleanText(updatedLine[2]);
          rereadId = todoId(updatedTitle);
          rereadTodo = { ...item, id: rereadId, title: updatedTitle, state: updatedLine[1].toLowerCase() === "x" ? "done" : item.state === "done" ? "needs_me" : item.state };
          const args = ["-C", servicesDir, "commit", "-m", `dashboard: ${action} ${id.split(":").pop()}`, "--", relative(servicesDir, line.path)];
          for (let attempt = 0; attempt < 2; attempt++) {
            // RC_SKIP_SNAPSHOTS: the services pre-commit hook otherwise regenerates INFRASTRUCTURE.md
            // and STACK.md (~45 s) on every commit; the next hand-made commit refreshes them.
            try { await execute(execFile, "git", args, { timeout: 30_000, env: { ...process.env, RC_SKIP_SNAPSHOTS: "1" } }); break; }
            catch (e) {
              const error = e.stderr || e.message;
              if (attempt === 0 && /cannot lock ref|index\.lock/i.test(error)) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
              } else { commitError = lastLine(error); break; }
            }
          }
        }
      }
      if (!result) {
        const updated = getWork(now).items.find((item) => item.id === rereadId) || rereadTodo;
        result = updated ? { status: 200, body: { ok: true, item: updated } } : fail(500, "work item missing after write");
      }
    }
  } catch (e) {
    result = fail(500, lastLine(e.stderr) || e.message);
  }
  log({ t: now.toISOString(), id, action, source, ok: result.body.ok, status: result.status,
    ...(!result.body.ok || commitError ? { error: result.body.error || commitError } : {}) });
  return result;
}
