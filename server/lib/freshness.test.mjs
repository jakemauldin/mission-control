// node --test server/lib/freshness.test.mjs
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

function run(t, scenario) {
  const dir = mkdtempSync(join(import.meta.dirname, ".freshness-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { mkdirSync, writeFileSync, utimesSync, rmSync, symlinkSync } from "node:fs";
    import { join } from "node:path";
    import { jobLogDrift, listRfiJobs, getRfi } from "./rfis.js";
    import { intakeCount, mediaCounts } from "./media.js";
    import { rfiTiers, tier5Media } from "./brief.js";
    import { looksLikeProject } from "./projects.js";
    const dir = process.env.SERVICES_DIR;
    const media = process.env.MC_MEDIA_DIR;
    const jobDir = join(dir, "rising-creek", "jobs", "119-x");
    const now = Date.parse("2026-10-12T17:00:00Z");
    Date.now = () => now;
    function file(path, text = "photo", time) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, text);
      if (time) utimesSync(path, new Date(time), new Date(time));
    }
    function rfi(revised = "2026-09-17", items = [
      { id: "A", title: "Confirm scope", status: "blocking", raised: "2026-10-09T17:00:00Z" },
      { id: "B", title: "Confirm price", status: "blocking", raised: "2026-10-10T17:00:00Z" },
      { id: "C", status: "before_submittal", raised: "2026-10-09T17:00:00Z" },
      { id: "D", status: "before_submittal", raised: "2026-10-10T17:00:00Z" },
      { id: "E", status: "closed" },
    ]) {
      file(join(jobDir, "rfi.json"), JSON.stringify({ job: "Test job", revised, groups: [{ items }] }), "2026-09-18T02:00:00Z");
    }
    const log = [
      "## 2026-10-09 ~10:00 CT, proposal status check",
      "## Undated heading 2026-10-12",
      "### 2026-10-11 not an entry",
      "## 2026-09-24 evening — LOI credit check",
      "## 2026-09-17 revised today",
      "## 2026-09-24 another entry on the same date",
      "## 2026-10-10suffix not a date heading",
    ].join("\\n");
    (${scenario.toString()})();
  `], { cwd: import.meta.dirname, env: { ...process.env, SERVICES_DIR: dir, MC_MEDIA_DIR: join(dir, "media") }, encoding: "utf-8" });
}

test("jobLogDrift counts dated headings strictly after revised and finds the greatest date", (t) => run(t, () => {
  file(join(jobDir, "JOB-LOG.md"), log);
  assert.deepEqual(jobLogDrift(jobDir, "2026-09-16"), { after: 4, latest: "2026-10-09" });
  assert.deepEqual(jobLogDrift(jobDir, "2026-09-17"), { after: 3, latest: "2026-10-09" });
  assert.deepEqual(jobLogDrift(jobDir, "2026-09-24"), { after: 1, latest: "2026-10-09" });
  assert.deepEqual(jobLogDrift(jobDir, "2026-10-09"), { after: 0, latest: "2026-10-09" });
  assert.deepEqual(jobLogDrift(jobDir, "2026-10-12"), { after: 0, latest: "2026-10-09" });
}));

test("jobLogDrift handles missing and undated logs", (t) => run(t, () => {
  assert.deepEqual(jobLogDrift(jobDir, null), { after: 0, latest: null });
  file(join(jobDir, "JOB-LOG.md"), "## Undated 2026-10-12\n### 2026-10-09 nested\n");
  assert.deepEqual(jobLogDrift(jobDir, "2026-09-17"), { after: 0, latest: null });
}));

test("jobLogDrift falls back to the RFI mtime's Chicago calendar date", (t) => run(t, () => {
  rfi(null);
  file(join(jobDir, "JOB-LOG.md"), "## 2026-09-17 same Chicago day\n## 2026-09-18 next day\n");
  for (const revised of [null, undefined, ""]) {
    assert.deepEqual(jobLogDrift(jobDir, revised), { after: 1, latest: "2026-09-18" });
  }
}));

test("RFI list and detail include jobLog and resolve SERVICES_DIR at call time", (t) => run(t, () => {
  rfi();
  file(join(jobDir, "JOB-LOG.md"), log);
  const rows = listRfiJobs();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].jobId, "119");
  assert.deepEqual(rows[0].counts, { blocking: 2, before_submittal: 2, cleanup: 0, closed: 1 });
  assert.deepEqual(rows[0].jobLog, { after: 3, latest: "2026-10-09" });
  assert.deepEqual(getRfi("119").jobLog, rows[0].jobLog);
  process.env.SERVICES_DIR = join(dir, "missing");
  assert.deepEqual(listRfiJobs(), []);
  assert.equal(getRfi("119"), null);
  assert.deepEqual(rfiTiers(), { t2: [], t4: [], blocking: 0 });
}));

test("Brief stale RFI titles show the list date and newer job log entries", (t) => run(t, () => {
  rfi();
  file(join(jobDir, "JOB-LOG.md"), log);
  const { t2, t4 } = rfiTiers();
  assert.deepEqual(t2.map(row => row.title), [
    "RFI A Confirm scope (#119) (list last updated 9/17)",
    "RFI B Confirm price (#119) (list last updated 9/17)",
  ]);
  assert.equal(t4[0].title, "2 open RFIs on #119, oldest 3 days. List last updated 9/17, job log has 3 newer entries");
}));

test("Brief fresh RFI titles stay unchanged with equal, older or missing log dates", (t) => run(t, () => {
  rfi("2026-10-09");
  file(join(jobDir, "JOB-LOG.md"), log);
  for (const revised of ["2026-10-09", "2026-10-12"]) {
    rfi(revised);
    const { t2, t4 } = rfiTiers();
    assert.deepEqual(t2.map(row => row.title), ["RFI A Confirm scope (#119)", "RFI B Confirm price (#119)"]);
    assert.equal(t4[0].title, "2 open RFIs on #119, oldest 3 days");
  }
  rmSync(join(jobDir, "JOB-LOG.md"));
  rfi();
  assert.equal(rfiTiers().t4[0].title, "2 open RFIs on #119, oldest 3 days");
}));

test("Brief uses singular RFI and entry and falls back to the Chicago list date", (t) => run(t, () => {
  rfi(null, [{ id: "A", title: "Confirm scope", status: "blocking" }, { id: "C", status: "before_submittal", raised: "2026-10-09T17:00:00Z" }]);
  file(join(jobDir, "JOB-LOG.md"), "## 2026-09-17 same day\n## 2026-09-18 newer\n");
  const { t2, t4 } = rfiTiers();
  assert.equal(t2[0].title, "RFI A Confirm scope (#119) (list last updated 9/17)");
  assert.equal(t4[0].title, "1 open RFI on #119, oldest 3 days. List last updated 9/17, job log has 1 newer entry");
}));

test("intakeCount recursively counts regular files and skips dotfiles, hidden directories and symlinks", (t) => run(t, () => {
  const intake = join(media, "phone-intake");
  file(join(intake, "one.jpg"), "photo", "2026-09-18T02:00:00Z");
  file(join(intake, "nested", "two.jpg"), "photo", "2026-10-09T17:00:00Z");
  file(join(intake, "nested", "more", "three.mov"), "video", "2026-10-10T17:00:00Z");
  file(join(intake, ".hidden.jpg"), "hidden", "2026-01-01T00:00:00Z");
  file(join(intake, ".hidden", "ignored.jpg"));
  mkdirSync(join(intake, "empty"));
  symlinkSync(join(intake, "one.jpg"), join(intake, "link.jpg"));
  assert.deepEqual(intakeCount(), { files: 3, oldest: "2026-09-18T02:00:00.000Z", newest: "2026-10-10T17:00:00.000Z" });
  assert.equal(mediaCounts().intake, 3);
  assert.deepEqual(tier5Media(), {
    rows: [{ tier: 5, key: "media:intake", title: "3 phone uploads not filed into the photo library, oldest 9/17", age: now - Date.parse("2026-09-18T02:00:00Z"), link: "/media" }],
    photos: 0,
  });
}));

test("intakeCount caches for five minutes, supports fresh reads and handles a missing folder", (t) => run(t, () => {
  const empty = { files: 0, oldest: null, newest: null };
  assert.deepEqual(intakeCount(), empty);
  assert.equal(mediaCounts().intake, 0);
  assert.deepEqual(tier5Media(), { rows: [], photos: 0 });
  const path = join(media, "phone-intake", "one.jpg");
  file(path, "photo", "2026-10-09T17:00:00Z");
  assert.deepEqual(intakeCount(), empty);
  assert.equal(intakeCount({ fresh: true }).files, 1);
  rmSync(path);
  Date.now = () => now + 299999;
  assert.equal(intakeCount().files, 1);
  Date.now = () => now + 300000;
  assert.deepEqual(intakeCount(), empty);
  rmSync(join(media, "phone-intake"), { recursive: true });
  assert.deepEqual(intakeCount({ fresh: true }), empty);
}));

test("Brief keeps the ungraded media row and adds a singular phone upload row", (t) => run(t, () => {
  file(join(media, "_catalogue.json"), JSON.stringify({ TEST: { file: "library/photo.jpg" } }));
  file(join(media, "phone-intake", "one.jpg"), "photo", "2026-10-09T17:00:00Z");
  assert.deepEqual(tier5Media(), {
    rows: [
      { tier: 5, key: "media:ungraded", title: "1 photos to grade", age: 0, link: "/media" },
      { tier: 5, key: "media:intake", title: "1 phone upload not filed into the photo library, oldest 10/9", age: now - Date.parse("2026-10-09T17:00:00Z"), link: "/media" },
    ],
    photos: 1,
  });
}));

test("project headings accept JT references while excluding bare job and PR numbers", (t) => run(t, () => {
  const headings = [
    ["## 🟡 Garza lead -> JT #126, preliminary budget (2026-09-18 pm)", true],
    ["## 🟡 Test job (JT #123)", true],
    ["## 🟡 viz-watch: X timelines as pinned List tabs ... verified on #129 (2026-10-09 ~10:40 CT, PR #108 open ...)", false],
    ["## 🟡 Test job (#123)", true],
    ["## 🟡 Test Job 123", true],
    ["## 🟡 Test job #129", false],
  ];
  for (const [title, expected] of headings) assert.equal(looksLikeProject({ emoji: "🟡", title }), expected, title);
  assert.equal(looksLikeProject({ emoji: "🔵", title: "JT #126" }), false);
  assert.equal(looksLikeProject({ emoji: null, title: "JT #126" }), false);
}));
