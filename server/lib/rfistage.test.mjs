// node --test server/lib/rfistage.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, utimesSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STAGES, stageOf, getRfi, listRfiJobs, updateRfiItem } from "./rfis.js";
import { rfiTiers } from "./brief.js";

const now = Date.parse("2026-10-13T02:00:00Z"); // Still 10/12 in Chicago.
const today = "2026-10-12";
const DAY = 86400000;

function rig(t, items = [{ id: "C-14", title: "Confirm scope", status: "blocking" }]) {
  const dir = mkdtempSync(join(import.meta.dirname, ".rfistage-test-"));
  const previous = process.env.SERVICES_DIR;
  process.env.SERVICES_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.SERVICES_DIR;
    else process.env.SERVICES_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  t.mock.timers.enable({ apis: ["Date"], now });
  const jobDir = join(dir, "rising-creek", "jobs", "119-x");
  mkdirSync(jobDir, { recursive: true });
  const path = join(jobDir, "rfi.json");
  const rfi = { job: "Test job", revised: "2026-09-17", groups: [{ title: "Civil", items }], extra: "untouched" };
  writeFileSync(path, JSON.stringify(rfi, null, 1));
  return {
    path, jobDir,
    text: () => readFileSync(path, "utf-8"),
    stored: () => JSON.parse(readFileSync(path, "utf-8")),
    update: (body) => updateRfiItem("119", "C-14", body),
  };
}

test("stageOf accepts valid stages, derives fallbacks and lets closed status win", () => {
  assert.deepEqual(STAGES, ["needs_answer", "agreed", "our_move", "closed"]);
  for (const stage of STAGES) assert.equal(stageOf({ status: "blocking", stage }), stage);
  for (const [status, expected] of [["blocking", "needs_answer"], ["before_submittal", "needs_answer"], ["cleanup", "our_move"], ["closed", "closed"], [undefined, "needs_answer"]]) {
    assert.equal(stageOf({ status }), expected);
    assert.equal(stageOf({ status, stage: "invalid" }), expected);
  }
  assert.equal(stageOf({ status: "closed", stage: "agreed" }), "closed");
});

test("stage changes append human words, close and reopen without becoming blocking", (t) => {
  const { update, stored } = rig(t);
  const changes = [
    ["agreed", "blocking", "Stage: needs an answer → agreed, waiting on drawings"],
    ["our_move", "blocking", "Stage: agreed, waiting on drawings → our move"],
    ["closed", "closed", "Stage: our move → closed"],
    ["needs_answer", "before_submittal", "Stage: closed → needs an answer"],
  ];
  for (const [stage, status, note] of changes) {
    const result = update({ stage });
    assert.equal(result.ok, true);
    assert.equal(result.item.stage, stage);
    assert.equal(result.item.status, status);
    assert.deepEqual(result.item.log.at(-1), { ts: new Date(now).toISOString(), who: "RCC", note });
  }
  assert.equal(stored().groups[0].items[0].log.length, 4);
  update({ stage: "needs_answer" });
  assert.equal(stored().groups[0].items[0].log.length, 4);
});

test("stage uses the derived old stage and preserves existing fields and log entries", (t) => {
  const oldLog = { ts: "2026-10-01", who: "Engineer", note: "Called RCC" };
  const { update, stored } = rig(t, [{ id: "C-14", status: "cleanup", stage: "invalid", raised: "2026-10-01", detail: "Keep", log: [oldLog] }]);
  const result = update({ stage: "agreed", note: "Confirmed" });
  assert.deepEqual(result.item.log.map(entry => entry.note), ["Called RCC", "Stage: our move → agreed, waiting on drawings", "Confirmed"]);
  assert.deepEqual(result.item.log[0], oldLog);
  assert.equal(result.item.detail, "Keep");
  assert.equal(result.item.raised, "2026-10-01");
  assert.equal(stored().extra, "untouched");
  assert.equal(stored().groups[0].title, "Civil");
});

test("reopening by stage overrides a stale stage on a closed item", (t) => {
  const { update } = rig(t, [{ id: "C-14", status: "closed", stage: "agreed" }]);
  const { item } = update({ stage: "agreed" });
  assert.equal(item.status, "before_submittal");
  assert.equal(item.stage, "agreed");
  assert.equal(item.log[0].note, "Stage: closed → agreed, waiting on drawings");
});

test("status close sets stage closed and non-closed status reopens to needs_answer", (t) => {
  const { update } = rig(t);
  assert.equal(update({ status: "closed" }).item.stage, "closed");
  for (const status of ["blocking", "before_submittal", "cleanup"]) {
    const { item } = update({ status });
    assert.equal(item.status, status);
    assert.equal(item.stage, "needs_answer");
    update({ status: "closed" });
  }
});

test("non-closed status reopens legacy closed items to needs_answer", (t) => {
  const { update } = rig(t, [{ id: "C-14", status: "closed" }]);
  assert.equal(update({ status: "cleanup" }).item.stage, "needs_answer");
});

test("invalid stage or status returns an error without writing", (t) => {
  const { update, text } = rig(t);
  const before = text();
  for (const stage of ["invalid", "", null, 1, {}]) {
    assert.ok(update({ stage, status: "closed", note: "Do not save" }).error);
    assert.equal(text(), before);
  }
  assert.ok(update({ status: "invalid", stage: "agreed" }).error);
  assert.equal(text(), before);
});

test("stands trims, collapses newline runs, accepts 400 characters and deletes empty text", (t) => {
  const { update, stored } = rig(t);
  assert.equal(update({ stands: "  Agreed\r\n\r\nwaiting\n\non drawings.\n " }).item.stands, "Agreed waiting on drawings.");
  assert.equal(update({ stands: "x".repeat(400) }).item.stands.length, 400);
  assert.ok(!Object.hasOwn(update({ stands: "" }).item, "stands"));
  assert.ok(!Object.hasOwn(stored().groups[0].items[0], "stands"));
  update({ stands: "Keep" });
  assert.ok(!Object.hasOwn(update({ stands: " \n " }).item, "stands"));
});

test("stands rejects invalid types and more than 400 characters without writing", (t) => {
  const { update, text } = rig(t);
  const before = text();
  for (const stands of [null, 12, {}, "x".repeat(401)]) {
    assert.ok(update({ stands, stage: "agreed" }).error);
    assert.equal(text(), before);
  }
});

test("next trims strings, uses Chicago today, preserves since for unchanged text and deletes", (t) => {
  const { update, stored } = rig(t, [{ id: "C-14", status: "blocking", next: { who: "Kimley-Horn", what: "Show pond", since: "2026-10-01" } }]);
  assert.deepEqual(update({ next: { who: " Kimley-Horn ", what: " Show pond " } }).item.next, { who: "Kimley-Horn", what: "Show pond", since: "2026-10-01" });
  assert.deepEqual(update({ next: { who: "Kimley-Horn", what: "Show detention pond", since: "1999-01-01" } }).item.next, { who: "Kimley-Horn", what: "Show detention pond", since: today });
  t.mock.timers.setTime(now + DAY);
  assert.equal(update({ next: { who: "Kimley-Horn", what: "Show detention pond" } }).item.next.since, today);
  assert.equal(update({ next: { who: "RCC", what: "Show detention pond" } }).item.next.since, "2026-10-13");
  assert.ok(!Object.hasOwn(update({ next: null }).item, "next"));
  assert.ok(!Object.hasOwn(stored().groups[0].items[0], "next"));
  assert.equal(update({ next: { who: " RCC ", what: " Send survey " } }).item.next.since, "2026-10-13");
});

test("next validates object and string lengths before writing", (t) => {
  const { update, text } = rig(t);
  assert.equal(update({ next: { who: "w".repeat(120), what: "x".repeat(300) } }).ok, true);
  const before = text();
  for (const next of ["invalid", [], {}, { who: 1, what: "x" }, { who: "w", what: null }, { who: "w".repeat(121), what: "x" }, { who: "w", what: "x".repeat(301) }]) {
    assert.ok(update({ next, stands: "Do not save" }).error);
    assert.equal(text(), before);
  }
});

test("note collapses newline runs and keeps the existing 2000-character limit", (t) => {
  const { update } = rig(t);
  assert.equal(update({ note: "Called\r\n\r\nengineer\n\ntoday" }).item.log[0].note, "Called engineer today");
  assert.equal(update({ note: "x".repeat(2001) }).item.log.at(-1).note.length, 2000);
  assert.equal(update({ note: 123 }).item.log.at(-1).note, "123");
});

test("writes use indent 1, no trailing newline and Chicago revised date", (t) => {
  const { update, path, stored, text } = rig(t);
  const { item } = update({ note: "Confirmed" });
  assert.equal(item.stage, "needs_answer");
  assert.ok(!Object.hasOwn(stored().groups[0].items[0], "stage"));
  assert.equal(stored().revised, today);
  assert.equal(text(), JSON.stringify(stored(), null, 1));
  assert.ok(text().startsWith('{\n "job":'));
  assert.ok(!text().endsWith("\n"));
  assert.equal(existsSync(path + ".tmp"), false);
});

test("getRfi derives stages without writing them back", (t) => {
  const { text } = rig(t, [{ id: "A", status: "cleanup" }, { id: "B", status: "blocking", stage: "invalid" }, { id: "C", status: "closed", stage: "agreed" }]);
  const before = text();
  assert.deepEqual(getRfi("119").groups[0].items.map(item => item.stage), ["our_move", "needs_answer", "closed"]);
  assert.equal(text(), before);
});

test("listRfiJobs preserves urgency counts and adds stage counts and blockingOpen", (t) => {
  rig(t, [
    { id: "A", status: "blocking", stage: "agreed" },
    { id: "B", status: "blocking" },
    { id: "C", status: "blocking", stage: "closed" },
    { id: "D", status: "before_submittal", stage: "invalid" },
    { id: "E", status: "cleanup" },
    { id: "F", status: "closed", stage: "agreed" },
  ]);
  const rows = listRfiJobs();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].counts, { blocking: 3, before_submittal: 1, cleanup: 1, closed: 1 });
  assert.deepEqual(rows[0].stages, { needs_answer: 2, agreed: 1, our_move: 1, closed: 2 });
  assert.equal(rows[0].blockingOpen, 2);
});

test("Brief excludes agreed and closed items, adds next owner and counts cleanup", (t) => {
  const { jobDir } = rig(t, [
    { id: "A", title: "Agreed", status: "blocking", stage: "agreed" },
    { id: "B", title: "Scope", status: "blocking", stage: "needs_answer", raised: "2026-09-01", next: { who: "Kimley-Horn", since: "2026-10-10" } },
    { id: "C", status: "cleanup", stage: "our_move", raised: "2026-09-01", next: { since: "2026-10-09" } },
    { id: "D", status: "before_submittal", stage: "agreed" },
    { id: "E", status: "closed", stage: "our_move" },
    { id: "F", status: "blocking", stage: "closed" },
  ]);
  writeFileSync(join(jobDir, "JOB-LOG.md"), "## 2026-10-10 Called engineer\n");
  const { t2, t4 } = rfiTiers();
  assert.equal(t2.length, 1);
  assert.equal(t2[0].title, "RFI B Scope (#119), next: Kimley-Horn (list last updated 9/17)");
  assert.equal(t2[0].age, now - Date.parse("2026-10-10"));
  assert.equal(t4.length, 1);
  assert.equal(t4[0].age, now - Date.parse("2026-10-09"));
  assert.equal(t4[0].title, "1 open RFI on #119, oldest 4 days. List last updated 9/17, job log has 1 newer entry");
});

test("Brief derives legacy stages and falls back through raised to file mtime", (t) => {
  const { path } = rig(t, [
    { id: "A", title: "Call", status: "blocking", stage: "our_move", raised: "2026-10-10" },
    { id: "B", title: "Answer", status: "blocking" },
    { id: "C", status: "cleanup" },
    { id: "D", status: "before_submittal", raised: "2026-10-09" },
  ]);
  const mtime = Date.parse("2026-10-11T02:00:00Z");
  utimesSync(path, new Date(mtime), new Date(mtime));
  const { t2, t4 } = rfiTiers();
  assert.deepEqual(t2.map(row => row.age), [now - Date.parse("2026-10-10"), now - mtime]);
  assert.equal(t2[0].title, "RFI A Call (#119)");
  assert.equal(t4[0].title, "2 open RFIs on #119, oldest 4 days");
  assert.equal(t4[0].age, now - Date.parse("2026-10-09"));
});
