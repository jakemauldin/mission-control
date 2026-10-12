// node --test server/lib/appbuilds.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { getApps, getPrFiles } from "./appbuilds.js";

const realDir = join(homedir(), "services", "projects", "app-builds");
const apps = [{ id: "one", roadmap: [{ title: "Launch", done: false }] }];
const status = { channels: {}, pending: [], marks: {} };
const files = [{ path: "app.js", patch: "+hello", add: 1, del: 0 }];
const data = {
  generated: "2026-10-12T12:00:00Z", since: "2026-10-01", apps: [{ id: "ignored" }],
  prs: [
    { app: "one", repo: "owner/one", number: 7, title: "First", head: "feature", base: "main", state: "open",
      created: "2026-10-01", updated: "2026-10-12", merged: null, add: 1, del: 0, summary: "Summary",
      url: "https://example.test/pr/7", files, more_files: 2 },
    { app: "two", repo: "owner/two", number: 7, files: [], more_files: 0 },
  ],
  branches: [{ repo: "owner/one", name: "feature", ahead: 1 }],
};

function useDir(t, dir) {
  const previous = process.env.APP_BUILDS_DIR;
  process.env.APP_BUILDS_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.APP_BUILDS_DIR;
    else process.env.APP_BUILDS_DIR = previous;
  });
}

function rig(t) {
  // Fixtures stay in the worktree; the real App Builds files are always read-only.
  const dir = fs.mkdtempSync(join(import.meta.dirname, ".appbuilds-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  useDir(t, dir);
  for (const [file, value] of [["apps.json", apps], ["status.json", status], ["data.json", data]]) {
    fs.writeFileSync(join(dir, file), JSON.stringify(value));
  }
  return dir;
}

test("slim copy strips files, preserves PR metadata, and counts files", (t) => {
  rig(t);
  const result = getApps();
  assert.deepEqual(result, {
    generated: data.generated, since: data.since, apps, status, branches: data.branches,
    prs: data.prs.map(({ files, ...pr }) => ({ ...pr, file_count: files.length })),
  });
  assert.ok(result.prs.every((pr) => !Object.hasOwn(pr, "files")));
});

test("real App Builds response is under 400 KB", { skip: !fs.existsSync(join(realDir, "data.json")) }, (t) => {
  useDir(t, realDir);
  const result = getApps();
  assert.equal(result.errors, undefined);
  const bytes = Buffer.byteLength(JSON.stringify(result));
  t.diagnostic(`Slim response: ${bytes} bytes`);
  assert.ok(bytes < 400_000, `${bytes} bytes exceeds 400 KB`); // 223 KB on 2026-10-12, against 4.7 MB with patches
});

test("data cache avoids rereads and refreshes on mtime or size changes", (t) => {
  const dir = rig(t);
  const path = join(dir, "data.json");
  const readFileSync = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    if (file === path) reads++;
    return readFileSync(file, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  getApps();
  getApps();
  assert.equal(reads, 1);
  const touched = new Date(fs.statSync(path).mtimeMs + 2000);
  fs.utimesSync(path, touched, touched);
  getApps();
  assert.equal(reads, 2);
  fs.appendFileSync(path, " ");
  fs.utimesSync(path, touched, touched);
  getApps();
  assert.equal(reads, 3);
});

test("bad JSON after a good read retains the cached data and reports an error", (t) => {
  const dir = rig(t);
  const good = getApps();
  fs.writeFileSync(join(dir, "data.json"), "{\"prs\":");
  for (let i = 0; i < 2; i++) {
    const { errors, ...result } = getApps();
    assert.deepEqual(result, good);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].file, "data.json");
    assert.equal(typeof errors[0].message, "string");
    assert.ok(errors[0].message.length > 0);
  }
  fs.writeFileSync(join(dir, "data.json"), JSON.stringify({ ...data, generated: "recovered" }));
  assert.equal(getApps().generated, "recovered");
  assert.equal(getApps().errors, undefined);
});

test("missing or unparsable files yield empty sections with errors", (t) => {
  const dir = rig(t);
  getApps();
  fs.unlinkSync(join(dir, "data.json"));
  fs.unlinkSync(join(dir, "apps.json"));
  fs.writeFileSync(join(dir, "status.json"), "{");
  const result = getApps();
  assert.deepEqual({ ...result, errors: undefined }, {
    generated: null, since: null, apps: [], prs: [], branches: [], status: {}, errors: undefined,
  });
  assert.deepEqual(result.errors.map((e) => e.file).sort(), ["apps.json", "data.json", "status.json"]);
  assert.equal(getPrFiles("owner/one", 7), null);
});

test("bad JSON without a cached copy yields empty data", (t) => {
  const dir = rig(t);
  fs.writeFileSync(join(dir, "data.json"), "{");
  const result = getApps();
  assert.equal(result.generated, null);
  assert.equal(result.since, null);
  assert.deepEqual(result.prs, []);
  assert.deepEqual(result.branches, []);
  assert.deepEqual(result.apps, apps);
  assert.deepEqual(result.status, status);
  assert.equal(result.errors[0].file, "data.json");
});

test("PR files are selected by repo and number, with null for an unknown pair", (t) => {
  const dir = rig(t);
  getApps();
  assert.deepEqual(getPrFiles("owner/one", 7), { files, more_files: 2 });
  assert.deepEqual(getPrFiles("owner/two", 7), { files: [], more_files: 0 });
  assert.equal(getPrFiles("owner/unknown", 7), null);
  assert.equal(getPrFiles("owner/one", 8), null);
  fs.writeFileSync(join(dir, "data.json"), "{");
  assert.equal(getPrFiles("owner/one", 7), null);
});
