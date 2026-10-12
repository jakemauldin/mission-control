// workitems.js — read-only work feed from the five services sources.
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { loadStore, getProjects } from "./projects.js";

const SERVICES = process.env.SERVICES_DIR || join(homedir(), "services");
const STATES = ["needs_me", "agent_working", "queued", "waiting", "done", "later"];
const cleanText = (s) => String(s || "").replace(/<!--.*?-->/g, "").replace(/\*\*|~~/g, "").replace(/\s+/g, " ").trim();
const normalized = (s) => cleanText(s).normalize("NFKC").toLowerCase();
const hash = (s) => createHash("sha1").update(normalized(s)).digest("hex").slice(0, 12);
const owner = (s) => s === "jake" || s === "agent" ? s : null;

function readText(path) {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function modified(path) {
  try { return statSync(path).mtime.toISOString(); } catch { return null; }
}

function timestamp(...values) {
  for (const value of values) {
    if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  return null;
}

// "Jake: do X", "Jake to send", "needs Jake", "you ..." are his; "Jake (Plaud 11:31): ..." only quotes him.
const JAKES = /^jake:|\bjake to\b|\bneeds jake\b|\byou\b/i;

function projectItems() {
  const store = loadStore();
  const items = [];
  for (const p of store.projects) {
    for (const todo of p.todos || []) {
      if (!todo.id || !todo.text) continue;
      // Agents add most to-dos through todo.sh (by "cli"); only Jake's own (by "ui") or ones that name him are his.
      const who = todo.owner !== undefined ? owner(todo.owner) : todo.by === "ui" || JAKES.test(todo.text) ? "jake" : null;
      items.push({
        id: `projects:${p.id}:${todo.id}`, source: "projects", sources: ["projects"],
        project: p.name, title: todo.text, owner: who,
        state: todo.done ? "done" : who === "jake" ? "needs_me" : "queued", writable: true,
        updatedAt: timestamp(todo.updated, todo.doneAt, p.lastTouched, todo.created, store.updated, modified(join(SERVICES, "projects", "projects.json"))),
      });
    }
  }
  return items;
}

function appItems() {
  const path = join(SERVICES, "projects", "app-builds", "apps.json");
  let apps = [];
  try { apps = JSON.parse(readText(path)); } catch { return []; }
  if (!Array.isArray(apps)) return [];
  const states = {
    running: "agent_working", building: "agent_working", testing: "agent_working", review: "agent_working",
    next: "queued", blocked: "waiting", waiting: "waiting", done: "done", later: "later",
  };
  const items = [];
  for (const app of apps) {
    for (const step of app.roadmap || []) {
      const title = cleanText(step.step);
      // done and later win over a jake lane, the same rule as the App Builds "Your moves" list.
      const state = step.state === "done" || step.state === "later" ? states[step.state]
        : step.state === "jake" || step.lane === "jake" ? "needs_me" : states[step.state];
      if (!title || !state) continue;
      items.push({
        id: step.id ? `apps:${step.id}` : `apps:${app.id}:${hash(title)}`, source: "apps", sources: ["apps"],
        project: app.name, title, owner: state === "needs_me" ? "jake" : step.lane || state === "agent_working" ? "agent" : null,
        state, updatedAt: timestamp(step.updated, app.updated, modified(path)), writable: true,
        ...(step.pr ? { link: step.pr } : {}), run: step.run ?? null, lane: step.lane ?? null,
      });
    }
  }
  return items;
}

function todoItems(now) {
  const dir = join(SERVICES, "docs", "status");
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith("-jake-todo.md")); } catch { return []; }
  const entries = files.map((file) => {
    const path = join(dir, file);
    const date = file.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    return { path, date: timestamp(date, modified(path)), mtime: modified(path) };
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.mtime).localeCompare(String(b.mtime)) || a.path.localeCompare(b.path));
  const byText = new Map();
  for (const file of entries) {
    const text = readText(file.path);
    const sessionId = text.match(/<!--\s*session:\s*([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\s*-->/i)?.[1];
    let state = null;
    for (const line of text.split(/\r?\n/)) {
      const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
      if (heading) {
        const title = cleanText(heading[1]);
        state = /^Waiting on you\b/i.test(title) ? "needs_me" : /^Later\b/i.test(title) ? "later" : /^Done\b/i.test(title) ? "done" : null;
      }
      const match = line.match(/^\s*- \[([ xX])\]\s+(.+)$/);
      if (!match) continue;
      const checked = match[1].toLowerCase() === "x";
      const title = cleanText(match[2]);
      if ((!state && !checked) || !title) continue;
      byText.set(normalized(title), {
        id: `todo:${hash(title)}`, source: "jake-todo", sources: ["jake-todo"],
        project: null, title, owner: "jake", state: checked ? "done" : state,
        updatedAt: file.date, writable: true, checked,
        ...(sessionId ? { sessionId } : {}),
      });
    }
  }
  const cutoff = Date.parse(now.toISOString().slice(0, 10)) - 7 * 86400000;
  // Choose the newest occurrence before expiring done items, so old open lines cannot reappear.
  return [...byText.values()].filter((item) => item.state !== "done" || !item.updatedAt || Date.parse(item.updatedAt) >= cutoff);
}

function backlogItems() {
  const path = join(SERVICES, "TODO.md");
  const items = new Map();
  let inBacklog = false;
  let fenced = false;
  let bullet = null;
  const flush = () => {
    if (!bullet || !/\b(?:needs Jake|Waiting on Jake)\b/i.test(bullet)) return;
    const text = cleanText(bullet);
    const title = (text.match(/^.*?[.!?](?=\s|$)/)?.[0] || text).slice(0, 200);
    if (!title) return;
    const id = `backlog:${hash(text)}`;
    items.set(id, {
      id, source: "backlog", sources: ["backlog"], project: null, title,
      owner: "jake", state: "needs_me", updatedAt: modified(path), writable: false,
    });
  };
  for (const line of readText(path).split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flush(); bullet = null;
      if (heading[1].length <= 2) inBacklog = heading[1] === "##" && heading[2] === "Open backlog";
      continue;
    }
    if (!inBacklog) continue;
    if (line.startsWith("- ")) {
      flush(); bullet = line.slice(2).trim();
    } else if (/^\s+\S/.test(line) && !/^\s+[-*+]\s/.test(line) && bullet) {
      bullet += ` ${line.trim()}`;
    } else if (line.trim()) {
      flush(); bullet = null;
    }
  }
  flush();
  return [...items.values()];
}

function inflightItems() {
  const states = { active: "agent_working", partial: "agent_working", waiting: "waiting", blocked: "waiting", done: "done" };
  return getProjects().projects.filter((p) => p.source === "inflight" && states[p.status]).map((p) => ({
    id: `inflight:${p.id}`, source: "inflight", sources: ["inflight"], project: p.name, title: p.name,
    owner: ["active", "partial"].includes(p.status) ? "agent" : null,
    state: states[p.status], updatedAt: timestamp(p.lastTouched, modified(join(SERVICES, "IN-FLIGHT.md"))), writable: false,
  }));
}

function matchingApp(todo, apps) {
  const exact = apps.filter((app) => {
    const stepId = app.id.slice(5);
    const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\w-])${escaped}($|[^\\w-])`).test(todo.title) || todo.title.includes(app.title);
  });
  if (exact.length === 1) return exact[0];
  const prefix = todo.title.match(/^Sloane? step (\d+)\b/i);
  if (!prefix) return null;
  const matches = apps.filter((app) => app.title.match(/^Sloan step (\d+)\b/i)?.[1] === prefix[1]);
  return matches.length === 1 ? matches[0] : null;
}

export function getWork(now = new Date()) {
  const apps = appItems();
  const todos = [];
  for (const { checked, ...todo } of todoItems(now)) {
    const app = matchingApp(todo, apps);
    if (!app) { todos.push(todo); continue; }
    if (!app.sources.includes("jake-todo")) app.sources.push("jake-todo");
    if (checked) app.state = "done";
    if (todo.sessionId) app.sessionId = todo.sessionId;
    app.updatedAt = timestamp(...[app.updatedAt, todo.updatedAt].sort().reverse());
  }
  const items = [...projectItems(), ...apps, ...todos, ...backlogItems(), ...inflightItems()];
  items.sort((a, b) => Number(b.state === "needs_me") - Number(a.state === "needs_me") || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const counts = Object.fromEntries(STATES.map((state) => [state, 0]));
  for (const item of items) counts[item.state]++;
  return { updated: now.toISOString(), items, counts };
}
