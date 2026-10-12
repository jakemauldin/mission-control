// node --test server/lib/workitems.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const fixtures = join(import.meta.dirname, "__fixtures__", "work");
const realDir = join(homedir(), "services");

function rig(t) {
  const dir = mkdtempSync(join(fixtures, ".test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of ["projects", "docs", "TODO.md", "IN-FLIGHT.md"]) cpSync(join(fixtures, file), join(dir, file), { recursive: true });
  return dir;
}

function getWork(dir, live = false) {
  // A fresh process also reloads projects.js with the fixture SERVICES_DIR.
  const script = `import { getWork } from "./workitems.js"; console.log(JSON.stringify(getWork(${live ? "" : 'new Date("2026-10-12T12:00:00Z")'})));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: import.meta.dirname, env: { ...process.env, SERVICES_DIR: dir }, encoding: "utf-8",
  }));
}

function writeTodo(dir, file, text) {
  writeFileSync(join(dir, "docs", "status", file), text);
}

test("apps states, owners, PRs and run metadata use the roadmap fields", (t) => {
  const result = getWork(rig(t));
  const expected = {
    "pn-jake": "needs_me", "pn-lane": "needs_me", "pn-done-jake": "done", "pn-running": "agent_working",
    "pn-building": "agent_working", "pn-testing": "agent_working", "pn-review": "agent_working",
    "pn-next": "queued", "pn-blocked": "waiting", "pn-waiting": "waiting",
    "pn-done": "done", "pn-later": "later", "pn-sloan-engine": "agent_working", "pn-sloan-spend": "agent_working",
  };
  for (const [id, state] of Object.entries(expected)) {
    const item = result.items.find((i) => i.id === `apps:${id}`);
    assert.equal(item.state, state, id);
    assert.equal(item.project, "PaceNotes");
    assert.equal(item.writable, true);
  }
  const jake = result.items.find((i) => i.id === "apps:pn-jake");
  assert.equal(jake.owner, "jake");
  assert.equal(jake.link, "https://example.test/pr/1");
  assert.equal(jake.run, "fixture run");
  assert.equal(jake.lane, "codex");
  assert.equal(result.items.find((i) => i.id === "apps:pn-building").owner, "agent");
});

test("steps without ids use stable app-scoped text hashes", (t) => {
  const dir = rig(t);
  const before = getWork(dir).items.find((i) => i.title === "Legacy step without an id");
  assert.match(before.id, /^apps:pacenotes:[0-9a-f]{12}$/);
  const path = join(dir, "projects", "app-builds", "apps.json");
  const apps = JSON.parse(readFileSync(path, "utf-8"));
  apps[0].roadmap.reverse();
  writeFileSync(path, JSON.stringify(apps));
  assert.equal(getWork(dir).items.find((i) => i.title === before.title).id, before.id);
  apps[0].roadmap.find((s) => s.step === before.title).step = "Reworded legacy step";
  writeFileSync(path, JSON.stringify(apps));
  assert.notEqual(getWork(dir).items.find((i) => i.title === "Reworded legacy step").id, before.id);
});

test("jake-todo ids survive moving a line, changing markup and renaming the file", (t) => {
  const dir = rig(t);
  const before = getWork(dir).items.find((i) => i.title === "Pick a microphone");
  assert.match(before.id, /^todo:[0-9a-f]{12}$/);
  writeTodo(dir, "2026-10-12-jake-todo.md", "## Later\n\n- [ ] ~~Pick   a microphone~~\n");
  renameSync(join(dir, "docs", "status", "2026-10-12-jake-todo.md"), join(dir, "docs", "status", "renamed-2026-10-12-jake-todo.md"));
  const after = getWork(dir).items.find((i) => i.title === before.title);
  assert.equal(after.id, before.id);
  assert.equal(after.state, "later");
});

test("unchecked older lines carry forward until a newer file checks them", (t) => {
  const dir = rig(t);
  const before = getWork(dir).items.find((i) => i.title === "Carry this forward");
  assert.equal(before.state, "needs_me");
  assert.equal(before.updatedAt, "2026-10-01T00:00:00.000Z");
  writeTodo(dir, "2026-10-12-jake-todo.md", "## Waiting on you\n- [x] **Carry this forward**\n");
  const matches = getWork(dir).items.filter((i) => i.title === before.title);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, before.id);
  assert.equal(matches[0].state, "done");
  assert.equal(matches[0].updatedAt, "2026-10-12T00:00:00.000Z");
  assert.ok(!matches.some((i) => i.state === "needs_me"));
});

test("done files older than seven days expire, with no resurrection of old open lines", (t) => {
  const dir = rig(t);
  writeTodo(dir, "2026-09-01-jake-todo.md", "## Waiting on you\n- [ ] Old finished task\n");
  writeTodo(dir, "2026-10-04-jake-todo.md", "## Done this session\n- [x] Expired on day eight\n");
  writeTodo(dir, "2026-10-05-jake-todo.md", "## Done this session\n- [x] Keep on day seven\n");
  const items = getWork(dir).items;
  assert.ok(!items.some((i) => ["Old finished task", "Expired on day eight"].includes(i.title)));
  assert.equal(items.find((i) => i.title === "Keep on day seven").state, "done");
  assert.equal(items.find((i) => i.title === "Older later task").state, "later");
});

test("checkbox headings, checked lines anywhere, title cleanup and session metadata", (t) => {
  const items = getWork(rig(t)).items;
  assert.ok(!items.some((i) => i.title === "This is just a note"));
  for (const title of ["Finished task", "Saved the rules", "Checked outside the named headings"]) {
    const item = items.find((i) => i.title === title);
    assert.equal(item.state, "done");
    assert.equal(item.sessionId, "12345678-1234-1234-1234-123456789abc");
    assert.equal(item.writable, true);
    assert.ok(!Object.hasOwn(item, "checked"));
  }
});

test("Sloan and Sloane step prefixes fold into the roadmap; roadmap state wins", (t) => {
  const dir = rig(t);
  let items = getWork(dir).items;
  const engine = items.find((i) => i.id === "apps:pn-sloan-engine");
  assert.deepEqual(engine.sources, ["apps", "jake-todo"]);
  assert.equal(engine.state, "agent_working");
  assert.equal(engine.sessionId, "12345678-1234-1234-1234-123456789abc");
  assert.ok(!items.some((i) => i.source === "jake-todo" && i.title.startsWith("Sloan step 1")));
  writeTodo(dir, "2026-10-12-jake-todo.md", "## Waiting on you\n- [x] sLoAnE step 2 needs you: choose the test cap\n");
  items = getWork(dir).items;
  assert.equal(items.find((i) => i.id === "apps:pn-sloan-spend").state, "done");
  assert.deepEqual(items.find((i) => i.id === "apps:pn-sloan-spend").sources, ["apps", "jake-todo"]);
});

test("dedupe retains exact step ids and titles, without matching id prefixes", (t) => {
  const dir = rig(t);
  writeTodo(dir, "2026-10-12-jake-todo.md", "## Waiting on you\n- [ ] Check pn-review today\n- [x] Please Build the package before launch\n- [ ] Check pn-review-extra today\n- [ ] Sloan step 10 needs you: pick a laptop\n");
  const items = getWork(dir).items;
  assert.deepEqual(items.find((i) => i.id === "apps:pn-review").sources, ["apps", "jake-todo"]);
  assert.equal(items.find((i) => i.id === "apps:pn-building").state, "done");
  assert.ok(items.some((i) => i.source === "jake-todo" && i.title === "Check pn-review-extra today"));
  assert.ok(items.some((i) => i.source === "jake-todo" && i.title.startsWith("Sloan step 10")));
});

test("backlog reads top-level bullet blocks only within Open backlog", (t) => {
  const items = getWork(rig(t)).items.filter((i) => i.source === "backlog");
  assert.deepEqual(items.map((i) => i.title).sort(), ["Account enrollment needs Jake.", "Choose the hardware."]);
  assert.ok(items.every((i) => i.owner === "jake" && i.state === "needs_me" && !i.writable));
});

test("garbled TODO and missing Open backlog yield zero backlog items", (t) => {
  const dir = rig(t);
  for (const text of ["\u0000garbled }{ Waiting on Jake\n- [\n##Open backlog\n", "- A task needs Jake.\n## Done\n- Waiting on Jake.\n"]) {
    writeFileSync(join(dir, "TODO.md"), text);
    assert.equal(getWork(dir).items.filter((i) => i.source === "backlog").length, 0);
  }
});

test("backlog first sentences are capped at 200 characters", (t) => {
  const dir = rig(t);
  writeFileSync(join(dir, "TODO.md"), `## Open backlog\n- needs Jake ${"x".repeat(220)}. Second sentence.\n`);
  const item = getWork(dir).items.find((i) => i.source === "backlog");
  assert.equal(item.title.length, 200);
});

test("project todos are Jake's only when he added them, and IN-FLIGHT cards stay read-only", (t) => {
  const result = getWork(rig(t));
  const shortcut = result.items.find((i) => i.id === "projects:voice:shortcut");
  assert.equal(shortcut.owner, "jake");
  assert.equal(shortcut.state, "needs_me");
  assert.equal(shortcut.writable, true);
  assert.equal(result.items.find((i) => i.id === "projects:voice:test").owner, "agent");
  const cli = result.items.find((i) => i.id === "projects:voice:agentcli");
  assert.equal(cli.owner, null);
  assert.equal(cli.state, "queued");
  const notes = result.items.find((i) => i.id === "projects:voice:notes");
  assert.equal(notes.state, "done");
  assert.equal(notes.owner, null);
  const inflight = result.items.filter((i) => i.source === "inflight");
  assert.equal(inflight.length, 4);
  assert.deepEqual(inflight.map((i) => i.state).sort(), ["agent_working", "agent_working", "done", "waiting"]);
  assert.ok(inflight.every((i) => !i.writable));
});

test("feed counts all states and sorts needs_me first, then newest first", (t) => {
  const result = getWork(rig(t));
  assert.equal(result.updated, "2026-10-12T12:00:00.000Z");
  assert.deepEqual(Object.keys(result.counts), ["needs_me", "agent_working", "queued", "waiting", "done", "later"]);
  for (const [state, count] of Object.entries(result.counts)) assert.equal(count, result.items.filter((i) => i.state === state).length);
  assert.equal(new Set(result.items.map((i) => i.id)).size, result.items.length);
  for (let i = 1; i < result.items.length; i++) {
    const a = result.items[i - 1], b = result.items[i];
    if (a.state === "needs_me" && b.state !== "needs_me") continue;
    assert.ok(!(a.state !== "needs_me" && b.state === "needs_me"));
    assert.ok(String(a.updatedAt || "") >= String(b.updatedAt || ""));
  }
});

test("live services has unique ids and needs_me work", { skip: !existsSync(realDir) }, (t) => {
  const result = getWork(realDir, true);
  assert.equal(new Set(result.items.map((i) => i.id)).size, result.items.length);
  assert.ok(result.counts.needs_me > 0);
  t.diagnostic(`Live counts: ${JSON.stringify(result.counts)}`);
  for (const item of result.items.filter((i) => i.state === "needs_me").slice(0, 10)) t.diagnostic(item.title);
});
