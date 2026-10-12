// node --test server/lib/workactions.test.mjs
import test from "node:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const fixtures = join(import.meta.dirname, "__fixtures__", "work");

function run(t, scenario, config = {}) {
  const dir = mkdtempSync(join(fixtures, ".actions-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of ["projects", "docs", "TODO.md", "IN-FLIGHT.md"]) cpSync(join(fixtures, file), join(dir, file), { recursive: true });
  // A fresh process keeps projects.js and workitems.js on the same fixture SERVICES_DIR.
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    import { applyWorkAction } from "./workactions.js";
    import { getWork } from "./workitems.js";
    const dir = process.env.SERVICES_DIR;
    const config = ${JSON.stringify(config)};
    const now = () => new Date("2026-10-13T02:00:00Z"); // Still 10/12 in Chicago.
    const calls = [];
    const failures = [];
    const logPath = join(dir, "work-log.jsonl");
    const todoPath = join(dir, "docs", "status", "2026-10-12-jake-todo.md");
    const appsPath = join(dir, "projects", "app-builds", "apps.json");
    const items = () => getWork(now()).items;
    const find = (title) => items().find((item) => item.title === title);
    const logs = () => existsSync(logPath) ? readFileSync(logPath, "utf-8").trim().split("\\n").map(JSON.parse) : [];
    function execFile(file, args, options, callback) {
      calls.push({ file, args, options });
      const failure = failures.shift();
      if (failure) return callback(Object.assign(new Error("command failed"), { code: 1 }), "", failure);
      if (file === "python3") {
        const apps = JSON.parse(readFileSync(appsPath, "utf-8"));
        const step = apps.flatMap((app) => app.roadmap || []).find((step) => step.id === args[2]);
        for (const field of ["state", "lane", "note"]) {
          const index = args.indexOf("--" + field);
          if (index !== -1) step[field] = args[index + 1];
        }
        step.updated = "2026-10-13T02:00:00Z";
        writeFileSync(appsPath, JSON.stringify(apps));
      } else assert.equal(file, "git");
      callback(null, "", "");
    }
    async function act(id, body) {
      const before = logs().length;
      const result = await applyWorkAction(id, body, {
        servicesDir: dir, execFile, now,
        log: (entry) => appendFileSync(logPath, JSON.stringify(entry) + "\\n"),
      });
      const entries = logs();
      assert.equal(entries.length, before + 1, "one log line per call");
      const entry = entries.at(-1);
      assert.equal(entry.id, id);
      assert.equal(entry.action, typeof body?.action === "string" ? body.action : null);
      assert.equal(entry.t, now().toISOString());
      assert.equal(entry.ok, result.body.ok);
      assert.equal(entry.status, result.status);
      if (!entry.ok) assert.equal(entry.error, result.body.error);
      assert.ok(Object.keys(entry).every((key) => ["t", "id", "action", "source", "ok", "status", "error"].includes(key)));
      return result;
    }
    await (${scenario.toString()})();
  `], { cwd: import.meta.dirname, env: { ...process.env, SERVICES_DIR: dir }, encoding: "utf-8" });
}

test("projects done/reopen/note round trip and assign refusal", (t) => run(t, async () => {
  const id = "projects:voice:shortcut";
  let result = await act(id, { action: "done" });
  assert.equal(result.status, 200);
  assert.equal(result.body.item.state, "done");
  result = await act(id, { action: "reopen" });
  assert.equal(result.body.item.state, "needs_me");
  result = await act(id, { action: "note", text: "Found\r\nthe shortcut" });
  assert.equal(result.body.item.title, "Create the watch Shortcut — note 10/12: Found the shortcut");
  const stored = JSON.parse(readFileSync(join(dir, "projects", "projects.json"), "utf-8")).projects[0].todos[0];
  assert.equal(stored.text, result.body.item.title);
  assert.equal(stored.done, false);
  assert.equal((await act(id, { action: "assign", lane: "codex" })).status, 422);
  assert.equal(calls.length, 0);
  assert.ok(logs().every((entry) => entry.source === "projects"));
}));

test("apps exact argv, timeout and reread for all actions and both lanes", (t) => run(t, async () => {
  const id = "apps:pn-next";
  const cases = [
    [{ action: "done" }, ["--state", "done", "--note", "done from dashboard"], "done"],
    [{ action: "reopen" }, ["--state", "next", "--note", "reopened from dashboard"], "queued"],
    [{ action: "note", text: "Check 'quotes'; $(ignored)\nnext" }, ["--note", "Check 'quotes'; $(ignored) next"], "queued"],
    [{ action: "assign", lane: "codex" }, ["--state", "next", "--lane", "codex", "--note", "handed off from dashboard"], "queued"],
    [{ action: "assign", lane: "claude" }, ["--state", "next", "--lane", "claude", "--note", "handed off from dashboard"], "queued"],
  ];
  for (const [body, args, state] of cases) {
    const result = await act(id, body);
    assert.equal(result.status, 200);
    assert.equal(result.body.item.state, state);
    assert.equal(result.body.item.updatedAt, now().toISOString());
    if (body.lane) assert.equal(result.body.item.lane, body.lane);
    const call = calls.at(-1);
    assert.equal(call.file, "python3");
    assert.deepEqual(call.args, [join(dir, "scripts", "roadmap.py"), "set", "pn-next", ...args, "--no-refresh"]);
    assert.equal(call.options.timeout, 20_000);
    assert.equal(call.options.shell, undefined);
  }
}));

test("apps reject bad lanes and generated ids without executing; stderr last line on failure", (t) => run(t, async () => {
  for (const lane of [undefined, "jake", "CODEX", "codex --state done"]) {
    assert.equal((await act("apps:pn-next", { action: "assign", lane })).status, 400);
  }
  assert.equal((await act(find("Legacy step without an id").id, { action: "done" })).status, 422);
  assert.equal(calls.length, 0);
  failures.push("Traceback details\nroadmap failed\n");
  const result = await act("apps:pn-next", { action: "done" });
  assert.deepEqual(result, { status: 500, body: { ok: false, error: "roadmap failed" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.timeout, 20_000);
}));

test("jake-todo done, reopen and note preserve markup and return updated ids", (t) => run(t, async () => {
  const original = find("Pick a microphone");
  let result = await act(original.id, { action: "done", expect: original.title });
  assert.equal(result.status, 200);
  assert.equal(result.body.item.state, "done");
  assert.equal(result.body.item.title, "Pick a microphone (done 10/12 from dashboard)");
  assert.notEqual(result.body.item.id, original.id);
  assert.match(readFileSync(todoPath, "utf-8"), /^- \[x\] \*\*Pick a microphone\*\* \(done 10\/12 from dashboard\)$/m);
  assert.equal(calls[0].file, "git");
  assert.deepEqual(calls[0].args, ["-C", dir, "commit", "-m", "dashboard: done " + original.id.slice(5), "--", "docs/status/2026-10-12-jake-todo.md"]);
  assert.equal(calls[0].options.env.RC_SKIP_SNAPSHOTS, "1");
  assert.equal(calls[0].options.timeout, 30_000);
  result = await act(result.body.item.id, { action: "reopen", expect: result.body.item.title });
  assert.equal(result.body.item.state, "needs_me");
  assert.equal(result.body.item.id, original.id);
  assert.match(readFileSync(todoPath, "utf-8"), /^- \[ \] \*\*Pick a microphone\*\*$/m);
  result = await act(original.id, { action: "note", expect: original.title, text: "Bring\nheadphones" });
  assert.equal(result.body.item.title, "Pick a microphone (note 10/12: Bring headphones)");
  assert.match(readFileSync(todoPath, "utf-8"), /^- \[ \] \*\*Pick a microphone\*\* \(note 10\/12: Bring headphones\)$/m);
  assert.ok(readdirSync(join(dir, "docs", "status")).every((file) => !file.endsWith(".tmp")));
  assert.equal(calls.length, 3);
}));

test("jake-todo requires expect and refuses stale or duplicate lines without writes", (t) => run(t, async () => {
  const item = find("Pick a microphone");
  const original = readFileSync(todoPath, "utf-8");
  assert.equal((await act(item.id, { action: "done" })).status, 400);
  assert.equal((await act(item.id, { action: "done", expect: "Old wording" })).status, 409);
  assert.equal((await act(item.id, { action: "done", expect: "Finished task" })).status, 409);
  assert.equal((await act(item.id, { action: "assign", lane: "claude" })).status, 422);
  assert.equal(readFileSync(todoPath, "utf-8"), original);
  writeFileSync(todoPath, original + "\n- [ ] ~~Pick   a microphone~~\n");
  const duplicate = readFileSync(todoPath, "utf-8");
  assert.equal((await act(item.id, { action: "done", expect: item.title })).status, 409);
  assert.equal(readFileSync(todoPath, "utf-8"), duplicate);
  assert.equal(calls.length, 0);
}));

test("jake-todo edits only the newest matching file and preserves CRLF", (t) => run(t, async () => {
  const oldPath = join(dir, "docs", "status", "2026-10-01-jake-todo.md");
  const oldText = readFileSync(oldPath, "utf-8");
  writeFileSync(todoPath, "## Waiting on you\r\n- [ ] **Carry this forward**\r\n- [ ] Keep this line\r\n");
  const item = find("Carry this forward");
  const result = await act(item.id, { action: "done", expect: item.title });
  assert.equal(result.status, 200);
  assert.equal(readFileSync(oldPath, "utf-8"), oldText);
  assert.equal(readFileSync(todoPath, "utf-8"), "## Waiting on you\r\n- [x] **Carry this forward** (done 10/12 from dashboard)\r\n- [ ] Keep this line\r\n");
  assert.equal(calls[0].args.at(-1), "docs/status/2026-10-12-jake-todo.md");
}));

test("jake-todo can complete an older open item that then expires from the feed", (t) => run(t, async () => {
  const item = find("Carry this forward");
  const result = await act(item.id, { action: "done", expect: item.title });
  assert.equal(result.status, 200);
  assert.equal(result.body.item.state, "done");
  assert.equal(result.body.item.title, "Carry this forward (done 10/12 from dashboard)");
  assert.equal(calls[0].args.at(-1), "docs/status/2026-10-01-jake-todo.md");
}));

for (const lock of ["fatal: cannot lock ref 'HEAD'", "fatal: index.lock already exists"]) {
  test(`jake-todo retries once after ${lock}`, (t) => run(t, async () => {
    const item = find("Pick a microphone");
    failures.push(config.lock);
    const start = Date.now();
    const result = await act(item.id, { action: "done", expect: item.title });
    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args, calls[1].args);
    assert.ok(Date.now() - start >= 950);
    assert.equal(logs().at(-1).error, undefined);
  }, { lock }));
}

test("jake-todo logs a second commit failure while keeping the write", (t) => run(t, async () => {
  const item = find("Pick a microphone");
  failures.push("index.lock exists", "details\nindex.lock still exists\n");
  const result = await act(item.id, { action: "done", expect: item.title });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  assert.match(readFileSync(todoPath, "utf-8"), /\(done 10\/12 from dashboard\)/);
  assert.equal(logs().at(-1).error, "index.lock still exists");
}));

test("jake-todo does not retry an unrelated commit failure", (t) => run(t, async () => {
  const item = find("Pick a microphone");
  failures.push("nothing to commit");
  assert.equal((await act(item.id, { action: "done", expect: item.title })).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(logs().at(-1).error, "nothing to commit");
}));

test("backlog and inflight refuse every action and keep their files unchanged", (t) => run(t, async () => {
  for (const [source, file] of [["backlog", "TODO.md"], ["inflight", "IN-FLIGHT.md"]]) {
    const item = items().find((item) => item.source === source);
    const before = readFileSync(join(dir, file), "utf-8");
    for (const action of ["done", "reopen", "note", "assign"]) {
      assert.equal((await act(item.id, { action, text: "A note", lane: "codex" })).status, 422);
      assert.equal(logs().at(-1).source, source);
    }
    assert.equal(readFileSync(join(dir, file), "utf-8"), before);
  }
  assert.equal(calls.length, 0);
}));

test("bad input, unknown ids and note length boundaries log exactly once", (t) => run(t, async () => {
  const id = "projects:voice:shortcut";
  for (const body of [undefined, null, [], "done", {}, { action: "delete" }]) {
    assert.equal((await act(id, body)).status, 400);
  }
  for (const text of [undefined, null, 123, "", "\r\n", " ", "a".repeat(501)]) {
    assert.equal((await act(id, { action: "note", text })).status, 400);
  }
  assert.equal((await act("projects:missing:missing", { action: "done" })).status, 404);
  assert.equal(logs().at(-1).source, null);
  for (const text of ["a", "a".repeat(500)]) {
    assert.equal((await act(id, { action: "note", text, token: "never log me" })).status, 200);
  }
  assert.ok(!readFileSync(logPath, "utf-8").includes("never log me"));
  assert.equal(calls.length, 0);
}));
