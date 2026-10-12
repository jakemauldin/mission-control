// node --test server/lib/ring.test.mjs
// Drives the ring state machine with fake sockets, a fake clock and fake http/telegram.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRing, isBareLoopback, isQuietHour, telegramText } from "./ring.js";

class FakeWs extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.sent = []; this.pings = 0; this.terminated = false; }
  send(d) { this.sent.push(JSON.parse(d)); }
  ping() { this.pings++; }
  terminate() { this.terminated = true; this.readyState = 3; }
  say(m) { this.emit("message", typeof m === "string" ? m : JSON.stringify(m)); }
  of(type) { return this.sent.filter((m) => m.type === type); }
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function rig(over = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ring-"));
  const calls = { post: [], tg: [] };
  const clock = { t: Date.parse("2026-10-05T18:00:00Z") }; // 13:00 Chicago (CDT)
  const ring = createRing({
    env: {},
    dryRun: false,
    now: () => clock.t,
    logFile: join(dir, "ring-log.jsonl"),
    timeouts: { routine: 40, urgent: 25, critical: 25 },
    voiceDumpUrl: "http://vd.test",
    liveEmbedUrl: "https://live.test/live",
    readToken: () => "tok-123",
    postJson: async (url, body) => { calls.post.push({ url, body }); return over.post ? over.post(url, body) : { status: 200, ok: true }; },
    telegram: async (msg) => { calls.tg.push(msg); if (over.tgFail) throw new Error("tg down"); },
    ...over.opts,
  });
  const logLines = () => (existsSync(join(dir, "ring-log.jsonl")) ? readFileSync(join(dir, "ring-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { ring, calls, clock, logLines, dir };
}

function device(ring, id, { label = "Laptop", open = true, takesCalls = true, dropIn = false } = {}) {
  const ws = new FakeWs();
  ring.attach(ws);
  ws.say({ type: "hello", deviceId: id, label });
  ws.say({ type: "sign", open, takesCalls, dropIn });
  return ws;
}

const req = (addr, headers = {}, port = 3080) => ({ socket: { remoteAddress: addr, localPort: port }, headers: { host: `127.0.0.1:${port}`, ...headers } });

test("loopback check: bare loopback only, any proxy header refuses", () => {
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(isBareLoopback(req(a)), true, a);
  assert.equal(isBareLoopback(req("100.92.25.23")), false);
  assert.equal(isBareLoopback(req("172.17.0.2")), false);
  assert.equal(isBareLoopback(req(undefined)), false);
  for (const h of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded", "tailscale-user-login", "tailscale-user-name"]) {
    assert.equal(isBareLoopback(req("127.0.0.1", { [h]: "1.2.3.4" })), false, h);
  }
  assert.equal(isBareLoopback(req("127.0.0.1", { "content-type": "application/json" })), true);
});

test("loopback check: Host must be 127.0.0.1 or localhost on the server's own port", () => {
  assert.equal(isBareLoopback(req("127.0.0.1", { host: "localhost:3080" })), true);
  assert.equal(isBareLoopback(req("::1", { host: "[::1]:3080" })), true);
  // what tailscale serve passes through if it ever stopped adding forwarding headers
  assert.equal(isBareLoopback(req("127.0.0.1", { host: "risingcreek-ai.taild0b4c6.ts.net:8080" })), false);
  assert.equal(isBareLoopback(req("127.0.0.1", { host: "127.0.0.1:9999" })), false);
  assert.equal(isBareLoopback(req("127.0.0.1", { host: "evil.com" })), false);
  assert.equal(isBareLoopback({ socket: { remoteAddress: "127.0.0.1", localPort: 3080 }, headers: {} }), false);
});

test("create validates input and returns 202 with a 32 hex id", () => {
  const { ring } = rig();
  assert.equal(ring.create({}).status, 400);
  assert.equal(ring.create({ topic: "x", urgency: "loud" }).status, 400);
  const r = ring.create({ topic: "Edwards pool", brief: "b", from: "s1" });
  assert.equal(r.status, 202);
  assert.match(r.body.id, /^[0-9a-f]{32}$/);
});

test("clamps topic 120, brief 2000, from 80", async () => {
  const { ring, calls } = rig();
  const ws = device(ring, "dev-laptop-1");
  ring.create({ topic: "t".repeat(500), brief: "b".repeat(5000), from: "f".repeat(500) });
  await tick();
  assert.equal(calls.post[0].body.topic.length, 120);
  assert.equal(calls.post[0].body.text.length, 2000);
  assert.equal(calls.post[0].body.from.length, 80);
  assert.equal(ws.of("ring")[0].topic.length, 120);
});

test("device present: brief goes to voice-dump, ring goes to the device with ttl", async () => {
  const { ring, calls } = rig();
  const ws = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "Edwards pool", brief: "Needs a call", from: "session 129" });
  await tick();
  assert.equal(calls.post[0].url, "http://vd.test/live/ceo/brief");
  assert.deepEqual(calls.post[0].body, { ring: body.id, topic: "Edwards pool", text: "Needs a call", from: "session 129" });
  const m = ws.of("ring")[0];
  assert.equal(m.id, body.id);
  assert.equal(m.urgency, "routine");
  assert.ok(m.expiresAt > Date.now() - 1e12 && m.ttlMs === 40);
  assert.equal(ring.get(body.id).state, "ringing");
  assert.equal(ring.get(body.id).delivered, "chime");
});

test("reachable needs open AND takesCalls AND a live socket", async () => {
  const { ring } = rig();
  const a = device(ring, "dev-aaaa-1", { open: true, takesCalls: false });
  assert.equal(ring.status().reachable, false);
  a.say({ type: "sign", open: true, takesCalls: true });
  assert.equal(ring.status().reachable, true);
  a.say({ type: "sign", open: false, takesCalls: true });
  assert.equal(ring.status().reachable, false);
  a.say({ type: "sign", open: true, takesCalls: true });
  a.readyState = 3; a.emit("close");
  assert.equal(ring.status().reachable, false);
  assert.equal(ring.status().devices[0].label, "Laptop");
});

test("first answer wins: ring_go to the answerer with url and token, ring_claimed to the rest", async () => {
  const { ring } = rig();
  const lap = device(ring, "dev-laptop-1");
  const lapTab2 = new FakeWs(); ring.attach(lapTab2); lapTab2.say({ type: "hello", deviceId: "dev-laptop-1", label: "Laptop" });
  const ph = device(ring, "dev-phone-01", { label: "Phone" });
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  lap.say({ type: "ring_answer", id: body.id });
  ph.say({ type: "ring_answer", id: body.id });
  assert.equal(ring.get(body.id).state, "answered");
  const go = lap.of("ring_go");
  assert.equal(go.length, 1);
  assert.equal(go[0].url, `https://live.test/live?job=ceo&autostart=1&embed=1&ring=${body.id}`);
  assert.equal(go[0].vdToken, "tok-123");
  assert.equal(ph.of("ring_go").length, 0);
  assert.equal(ph.of("ring_claimed").length >= 1, true);
  assert.equal(lapTab2.of("ring_claimed").length, 1);
  assert.equal(lap.of("ring_claimed").length, 0);
  await tick(60); // the timer must be cleared: no fallback after an answer
  assert.equal(ring.get(body.id).state, "answered");
});

test("token is read at answer time and never written to the log", async () => {
  let n = 0;
  const { ring, logLines } = rig({ opts: { readToken: () => `secret-${++n}` } });
  const ws = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  ws.say({ type: "ring_answer", id: body.id });
  assert.equal(ws.of("ring_go")[0].vdToken, "secret-1");
  assert.ok(!JSON.stringify(logLines()).includes("secret-"));
});

test("a missing token file still opens the call, with an empty token", async () => {
  const { ring } = rig({ opts: { readToken: () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); } } });
  const ws = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  ws.say({ type: "ring_answer", id: body.id });
  assert.equal(ws.of("ring_go")[0].vdToken, "");
});

test("answering an unknown or finished ring says claimed", async () => {
  const { ring } = rig();
  const ws = device(ring, "dev-laptop-1");
  ws.say({ type: "ring_answer", id: "nope" });
  assert.equal(ws.of("ring_claimed").length, 1);
  assert.equal(ws.of("ring_go").length, 0);
});

test("timeout routine: Telegram text, state fallback_telegram, devices told to stop", async () => {
  const { ring, calls } = rig();
  const ws = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "Edwards pool", brief: "Pool quote is in\nmore", from: "session 129" });
  await tick(80);
  assert.equal(ring.get(body.id).state, "fallback_telegram");
  assert.equal(ring.get(body.id).delivered, "telegram");
  assert.equal(calls.tg.length, 1);
  assert.equal(calls.tg[0], "session 129 wants to talk: Edwards pool. Pool quote is in. Open the dashboard or reply here.");
  assert.equal(ws.of("ring_cancelled").length, 1);
  assert.equal(calls.post.filter((c) => c.url.includes("/tw/ring")).length, 0);
});

test("Later on the only device falls back right away", async () => {
  const { ring, calls } = rig();
  const ws = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  ws.say({ type: "ring_later", id: body.id });
  await tick();
  assert.equal(ring.get(body.id).state, "fallback_telegram");
  assert.equal(calls.tg.length, 1);
});

test("Later on one of two devices keeps ringing the other", async () => {
  const { ring } = rig();
  const a = device(ring, "dev-laptop-1");
  const b = device(ring, "dev-phone-01", { label: "Phone" });
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  a.say({ type: "ring_later", id: body.id });
  assert.equal(ring.get(body.id).state, "ringing");
  b.say({ type: "ring_answer", id: body.id });
  assert.equal(ring.get(body.id).state, "answered");
});

test("no one present: no_presence then immediate fallback, voice-dump not touched", async () => {
  const { ring, calls, logLines } = rig();
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  assert.equal(ring.get(body.id).state, "fallback_telegram");
  assert.equal(calls.post.length, 0);
  assert.ok(logLines().some((l) => l.state === "no_presence"));
});

test("brief POST fails: skip ringing, go straight to fallback", async () => {
  const { ring, calls } = rig({ post: () => ({ status: 500, ok: false }) });
  const ws = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  assert.equal(ws.of("ring").length, 0);
  assert.equal(ring.get(body.id).state, "fallback_telegram");
  assert.equal(calls.tg.length, 1);
});

test("brief POST throws: same", async () => {
  const { ring } = rig({ post: () => { throw new Error("ECONNREFUSED"); } });
  const ws = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  assert.equal(ws.of("ring").length, 0);
  assert.equal(ring.get(body.id).state, "fallback_telegram");
});

test("urgent timeout: cell ring (mode=auto, instruct) AND Telegram", async () => {
  const { ring, calls } = rig();
  device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "Inspector on site", brief: "Needs a decision", from: "s", urgency: "urgent" });
  await tick(60);
  const tw = calls.post.filter((c) => c.url.includes("/tw/ring"));
  assert.equal(tw.length, 1);
  assert.equal(tw[0].url, "http://vd.test/tw/ring?mode=auto");
  assert.deepEqual(tw[0].body, { instruct: "Inspector on site: Needs a decision" });
  assert.equal(calls.tg.length, 1);
  assert.equal(ring.get(body.id).state, "fallback_cell");
  assert.equal(ring.get(body.id).delivered, "cell");
});

test("urgent with 409 from /tw/ring: Telegram only", async () => {
  const { ring, calls } = rig({ post: (url) => (url.includes("/tw/ring") ? { status: 409, ok: false } : { status: 200, ok: true }) });
  const { body } = ring.create({ topic: "T", brief: "B", from: "f", urgency: "urgent" });
  await tick();
  assert.equal(calls.tg.length, 1);
  assert.equal(ring.get(body.id).state, "fallback_telegram");
});

test("quiet hours 21:00-06:00 Chicago: urgent is Telegram only, critical still rings the cell", async () => {
  assert.equal(isQuietHour(Date.parse("2026-10-05T18:00:00Z")), false); // 13:00 CDT
  assert.equal(isQuietHour(Date.parse("2026-10-06T02:00:00Z")), true);  // 21:00 CDT
  assert.equal(isQuietHour(Date.parse("2026-10-06T01:59:00Z")), false); // 20:59 CDT
  assert.equal(isQuietHour(Date.parse("2026-10-06T10:59:00Z")), true);  // 05:59 CDT
  assert.equal(isQuietHour(Date.parse("2026-10-06T11:00:00Z")), false); // 06:00 CDT
  assert.equal(isQuietHour(Date.parse("2026-12-06T03:00:00Z")), true);  // 21:00 CST (winter offset)
  const night = Date.parse("2026-10-06T04:00:00Z"); // 23:00 Chicago
  const u = rig(); u.clock.t = night;
  const ru = u.ring.create({ topic: "Late", brief: "B", from: "f", urgency: "urgent" });
  await tick();
  assert.equal(u.calls.post.filter((c) => c.url.includes("/tw/ring")).length, 0);
  assert.equal(u.calls.tg.length, 1);
  assert.equal(u.ring.get(ru.body.id).state, "fallback_telegram");
  const c = rig(); c.clock.t = night;
  const rc = c.ring.create({ topic: "Fire", brief: "B", from: "f", urgency: "critical" });
  await tick();
  assert.equal(c.calls.post.filter((x) => x.url.includes("/tw/ring")).length, 1);
  assert.equal(c.calls.tg.length, 1);
  assert.equal(c.ring.get(rc.body.id).state, "fallback_cell");
});

test("one cell ring per topic per 30 min", async () => {
  const { ring, calls, clock } = rig();
  ring.create({ topic: "Same Topic", brief: "B", from: "a", urgency: "urgent" });
  await tick();
  ring.create({ topic: "same topic", brief: "B", from: "b", urgency: "urgent" });
  await tick();
  assert.equal(calls.post.filter((c) => c.url.includes("/tw/ring")).length, 1);
  assert.equal(calls.tg.length, 2);
  clock.t += 31 * 60_000;
  ring.create({ topic: "Same Topic", brief: "B", from: "c", urgency: "urgent" });
  await tick();
  assert.equal(calls.post.filter((c) => c.url.includes("/tw/ring")).length, 2);
  ring.create({ topic: "Other", brief: "B", from: "d", urgency: "urgent" });
  await tick();
  assert.equal(calls.post.filter((c) => c.url.includes("/tw/ring")).length, 3);
});

test("max 3 rings per 10 min per from, window slides, other callers unaffected", async () => {
  const { ring, clock } = rig();
  for (let i = 0; i < 3; i++) assert.equal(ring.create({ topic: `t${i}`, brief: "", from: "loop" }).status, 202);
  assert.equal(ring.create({ topic: "t4", brief: "", from: "loop" }).status, 429);
  assert.equal(ring.create({ topic: "t4", brief: "", from: "other" }).status, 202);
  clock.t += 10 * 60_000 + 1;
  assert.equal(ring.create({ topic: "t5", brief: "", from: "loop" }).status, 202);
});

test("telegram failure and no cell: fallback_failed", async () => {
  const { ring } = rig({ tgFail: true });
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  assert.equal(ring.get(body.id).state, "fallback_failed");
});

test("RING_DRY_RUN records what would be sent and sends nothing", async () => {
  const { ring, calls, logLines } = rig({ opts: { dryRun: true, voiceDumpUrl: undefined, env: {} } });
  const { body } = ring.create({ topic: "Dry", brief: "B", from: "f", urgency: "urgent" });
  await tick();
  assert.equal(calls.post.length, 0);
  assert.equal(calls.tg.length, 0);
  assert.equal(ring.get(body.id).state, "fallback_cell");
  const would = logLines().filter((l) => l.event === "would_send").map((l) => l.to);
  assert.deepEqual(would.sort(), ["telegram", "voice-dump /tw/ring?mode=auto"]);
});

test("dry run with a stub VOICE_DUMP_URL still posts the brief, and still sends no cell or Telegram", async () => {
  const { ring, calls } = rig({ opts: { dryRun: true } });
  device(ring, "dev-laptop-1");
  ring.create({ topic: "Dry", brief: "B", from: "f" });
  await tick(80);
  assert.equal(calls.post.length, 1);
  assert.ok(calls.post[0].url.endsWith("/live/ceo/brief"));
  assert.equal(calls.tg.length, 0);
});

test("every ring and outcome lands in the log file", async () => {
  const { ring, logLines } = rig();
  const { body } = ring.create({ topic: "Logged", brief: "B", from: "f" });
  await tick();
  const mine = logLines().filter((l) => l.id === body.id);
  assert.equal(mine[0].event, "created");
  assert.ok(mine.some((l) => l.state === "fallback_telegram"));
});

test("a device that signs open mid-ring gets the ring; a declined one does not get it back", async () => {
  const { ring } = rig();
  const a = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  const b = new FakeWs(); ring.attach(b);
  b.say({ type: "hello", deviceId: "dev-phone-01", label: "Phone" });
  b.say({ type: "sign", open: true, takesCalls: true });
  assert.equal(b.of("ring").length, 1);
  a.say({ type: "ring_later", id: body.id });
  a.say({ type: "sign", open: true, takesCalls: true });
  assert.equal(a.of("ring").length, 1);
});

test("socket hardening: oversize message, rate limit, bad json, no hello, bad ids", async () => {
  const { ring } = rig();
  const ws = new FakeWs(); ring.attach(ws);
  ws.say({ type: "sign", open: true, takesCalls: true });          // before hello
  assert.equal(ring.status().devices.length, 0);
  ws.say({ type: "hello", deviceId: "../etc", label: "x" });        // bad id
  assert.equal(ring.status().devices.length, 0);
  ws.say("not json");
  ws.say(JSON.stringify({ type: "hello", deviceId: "dev-laptop-1", label: "L".repeat(5000) })); // > 4 KB
  assert.equal(ring.status().devices.length, 0);
  ws.say({ type: "hello", deviceId: "dev-laptop-1", label: "L".repeat(200) });
  assert.equal(ring.status().devices[0].label.length, 40);
  // rate: 20 per 10 s per socket; 3 so far counted, so the 18th more is the last honored
  for (let i = 0; i < 40; i++) ws.say({ type: "sign", open: i % 2 === 0, takesCalls: true });
  const sent = ws.of("presence").length;
  assert.ok(sent <= 20, `presence pushes ${sent}`);
});

test("heartbeat: pings every sweep, terminates after 45 s without a pong", async () => {
  const { ring, clock } = rig();
  const ws = device(ring, "dev-laptop-1");
  clock.t += 20_000; ring.sweep();
  assert.equal(ws.pings, 1);
  ws.emit("pong");
  clock.t += 30_000; ring.sweep();   // 30 s since the pong
  assert.equal(ws.terminated, false);
  clock.t += 20_000; ring.sweep();   // 50 s since the pong
  assert.equal(ws.terminated, true);
  assert.equal(ring.status().reachable, false);
});

test("last device dropping mid-ring falls back instead of waiting out the timer", async () => {
  const { ring, calls } = rig({ opts: { timeouts: { routine: 5000, urgent: 5000, critical: 5000 } } });
  const ws = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  ws.readyState = 3; ws.emit("close");
  await tick();
  assert.equal(ring.get(body.id).state, "fallback_telegram");
  assert.equal(calls.tg.length, 1);
});

test("telegram text has no semicolons and survives odd input", () => {
  assert.equal(telegramText({ from: "a;b", topic: "x; y.", brief: "one; two\nthree" }), "a,b wants to talk: x, y. one, two. Open the dashboard or reply here.");
  assert.equal(telegramText({ from: "", topic: "Topic", brief: "" }), "Someone wants to talk: Topic. Open the dashboard or reply here.");
  assert.ok(!telegramText({ from: "f", topic: "t;", brief: ";" }).includes(";"));
});

test("a device that went away is listed for 10 min, forgotten after an hour", async () => {
  const { ring, clock } = rig();
  const ws = device(ring, "dev-laptop-1");
  ws.readyState = 3; ws.emit("close");
  assert.equal(ring.status().devices.length, 1);
  clock.t += 11 * 60_000;
  assert.equal(ring.status().devices.length, 0);
  clock.t += 50 * 60_000; ring.sweep();
  assert.equal(ring.devices.size, 0);
});

test("a device that signs in while the brief POST is in flight is not rung early, and a failed brief cannot be answered", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { ring, calls } = rig({ post: async () => { await gate; return { status: 500, ok: false }; } });
  const a = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  const b = new FakeWs(); ring.attach(b);
  b.say({ type: "hello", deviceId: "dev-phone-01", label: "Phone" });
  b.say({ type: "sign", open: true, takesCalls: true });
  assert.equal(b.of("ring").length, 0, "no ring before the brief lands");
  release();
  await tick(20);
  assert.equal(a.of("ring").length, 0);
  assert.equal(b.of("ring").length, 0);
  assert.equal(ring.get(body.id).state, "fallback_telegram");
  assert.equal(calls.tg.length, 1);
});

test("brief failure leaves ringing before the slow Telegram send, so a late answer cannot win", async () => {
  let tgDone;
  const slow = new Promise((r) => { tgDone = r; });
  const { ring, calls } = rig({ post: async () => ({ status: 500, ok: false }), opts: { telegram: async (m) => { calls.tg.push(m); await slow; } } });
  const a = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  assert.notEqual(ring.get(body.id).state, "ringing");
  a.say({ type: "ring_answer", id: body.id });
  assert.equal(a.of("ring_go").length, 0);
  tgDone();
  await tick();
  assert.equal(ring.get(body.id).state, "fallback_telegram");
});

test("closing the sign mid-ring cancels that banner and falls back without waiting for the timer", async () => {
  const { ring, calls } = rig({ opts: { timeouts: { routine: 5000, urgent: 5000, critical: 5000 } } });
  const a = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  assert.equal(a.of("ring").length, 1);
  a.say({ type: "sign", open: false, takesCalls: true });
  assert.equal(a.of("ring_cancelled").length, 1);
  await tick();
  assert.equal(ring.get(body.id).state, "fallback_telegram");
  assert.equal(calls.tg.length, 1);
});

test("closing the sign on one of two devices keeps ringing the other", async () => {
  const { ring } = rig({ opts: { timeouts: { routine: 5000, urgent: 5000, critical: 5000 } } });
  const a = device(ring, "dev-laptop-1");
  const b = device(ring, "dev-phone-01", { label: "Phone" });
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  a.say({ type: "sign", open: false, takesCalls: true });
  assert.equal(a.of("ring_cancelled").length, 1);
  assert.equal(b.of("ring_cancelled").length, 0);
  assert.equal(ring.get(body.id).state, "ringing");
});

test("global cap: 10 rings per 10 min across callers, one log line, window slides", async () => {
  const { ring, clock, logLines } = rig();
  for (let i = 0; i < 10; i++) assert.equal(ring.create({ topic: `t${i}`, brief: "", from: `agent-${i}` }).status, 202);
  assert.equal(ring.create({ topic: "t11", brief: "", from: "agent-new" }).status, 429);
  assert.equal(ring.create({ topic: "t12", brief: "", from: "agent-newer" }).status, 429);
  assert.equal(logLines().filter((l) => l.event === "rate_limited_global").length, 1);
  clock.t += 10 * 60_000 + 1;
  assert.equal(ring.create({ topic: "t13", brief: "", from: "agent-new" }).status, 202);
});

test("cell cap: 4th cell ring in an hour goes to Telegram only, even for new topics", async () => {
  const { ring, calls, clock } = rig();
  for (let i = 0; i < 4; i++) {
    ring.create({ topic: `topic ${i}`, brief: "B", urgency: "urgent", from: `agent-${i}` });
    await tick();
  }
  assert.equal(calls.post.filter((c) => c.url.includes("/tw/ring")).length, 3);
  assert.equal(calls.tg.length, 4);
  clock.t += 60 * 60_000 + 1;
  ring.create({ topic: "topic 5", brief: "B", urgency: "urgent", from: "agent-5" });
  await tick();
  assert.equal(calls.post.filter((c) => c.url.includes("/tw/ring")).length, 4);
});

test("a device on a call (busy) is not rung: falls back, and a ring already pending is cancelled", async () => {
  const { ring, calls } = rig({ opts: { timeouts: { routine: 5000, urgent: 5000, critical: 5000 } } });
  const a = device(ring, "dev-laptop-1");
  a.say({ type: "sign", open: true, takesCalls: true, busy: true });
  const r1 = ring.create({ topic: "second", brief: "B", from: "f" });
  await tick();
  assert.equal(a.of("ring").length, 0);
  assert.equal(ring.get(r1.body.id).state, "fallback_telegram");
  assert.equal(calls.post.filter((c) => c.url.includes("/live/ceo/brief")).length, 0);
  // not busy: rings; then a call starts while it rings
  a.say({ type: "sign", open: true, takesCalls: true, busy: false });
  const r2 = ring.create({ topic: "third", brief: "B", from: "g" });
  await tick();
  assert.equal(a.of("ring").length, 1);
  a.say({ type: "sign", open: true, takesCalls: true, busy: true });
  assert.equal(a.of("ring_cancelled").length, 1);
  await tick();
  assert.equal(ring.get(r2.body.id).state, "fallback_telegram");
});

test("an answered ring is never overwritten by a late fallback", async () => {
  const { ring } = rig();
  const a = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", brief: "B", from: "f" });
  await tick();
  a.say({ type: "ring_answer", id: body.id });
  await tick(60); // well past the 40 ms test timeout
  assert.equal(ring.get(body.id).state, "answered");
});

const SESSION = "a1234567-abcd-4123-8123-123456789abc";
const OTHER_SESSION = "b1234567-abcd-4123-8123-123456789abc";

test("sessionId accepts UUID v1-v8 and normalizes uppercase", () => {
  for (let version = 1; version <= 8; version++) {
    const { ring } = rig();
    const sessionId = SESSION.replace("-4123-", `-${version}123-`);
    const { status, body } = ring.create({ topic: "T", sessionId: sessionId.toUpperCase() });
    assert.equal(status, 202);
    assert.equal(ring.rings.get(body.id).sessionId, sessionId);
    assert.equal(ring.rings.get(body.id).desk, false);
  }
});

test("sessionId rejects malformed UUIDs, invalid versions, variants and non-strings", () => {
  const { ring } = rig();
  for (const sessionId of [
    "", "not-a-uuid", null, 123, true, {}, [],
    SESSION.replace("-4123-", "-0123-"), SESSION.replace("-4123-", "-9123-"),
    SESSION.replace("-8123-", "-7123-"), SESSION.replace("-8123-", "-c123-"),
    SESSION.replace("a123", "g123"), SESSION.replaceAll("-", ""),
    ` ${SESSION}`, `${SESSION}\n`,
  ]) {
    const result = ring.create({ topic: "T", sessionId });
    assert.equal(result.status, 400, JSON.stringify(sessionId));
    assert.match(result.body.error, /sessionId.*UUID/);
  }
  assert.equal(ring.rings.size, 0);
  const { status, body } = ring.create({ topic: "T" });
  assert.equal(status, 202);
  assert.equal(ring.rings.get(body.id).sessionId, null);
  assert.equal(ring.rings.get(body.id).desk, false);
});

test("desk rejects non-booleans", () => {
  const { ring } = rig();
  for (const desk of [null, 0, 1, "true", "false", {}, []]) {
    const result = ring.create({ topic: "T", desk });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /desk.*boolean/);
  }
  for (const desk of [true, false]) assert.equal(ring.create({ topic: "T", desk }).status, 202);
});

test("one session shares the caller cap across from strings and UUID casing", () => {
  const { ring, clock, logLines } = rig();
  assert.equal(ring.create({ topic: "T", from: "first", sessionId: SESSION }).status, 202);
  assert.equal(ring.create({ topic: "T", from: "second", sessionId: SESSION.toUpperCase() }).status, 202);
  assert.equal(ring.create({ topic: "T", from: "first", sessionId: SESSION }).status, 202);
  assert.equal(ring.create({ topic: "T", from: "second", sessionId: SESSION }).status, 429);
  assert.equal(logLines().find((l) => l.event === "rate_limited").from, `session:${SESSION}`);
  assert.equal(ring.create({ topic: "T", from: "first", sessionId: OTHER_SESSION }).status, 202);
  assert.equal(ring.create({ topic: "T", from: "first" }).status, 202);
  clock.t += 10 * 60_000;
  assert.equal(ring.create({ topic: "T", from: "second", sessionId: SESSION }).status, 202);
});

test("session rings still share the unchanged global cap", () => {
  const { ring } = rig();
  for (let i = 0; i < 10; i++) {
    const sessionId = SESSION.replace("a1234567", `a123456${i}`);
    assert.equal(ring.create({ topic: "T", sessionId }).status, 202);
  }
  assert.equal(ring.create({ topic: "T", sessionId: OTHER_SESSION }).status, 429);
});

test("session and desk reach the ring, ring_go, voice-dump brief and every ring log line", async () => {
  for (const desk of [true, false]) {
    const { ring, calls, logLines } = rig();
    const ws = device(ring, "dev-laptop-1");
    const { body } = ring.create({ topic: "T", brief: "B", from: "f", sessionId: SESSION.toUpperCase(), desk });
    await tick();
    assert.equal(ws.of("ring")[0].sessionId, SESSION);
    assert.equal(ws.of("ring")[0].desk, desk);
    assert.equal(ws.of("ring")[0].dropOk, true);
    assert.deepEqual(calls.post[0].body, { ring: body.id, topic: "T", text: "B", from: "f", sessionId: SESSION, desk });
    ws.say({ type: "ring_answer", id: body.id });
    assert.equal(ws.of("ring_go")[0].sessionId, SESSION);
    assert.equal(ws.of("ring_go")[0].desk, desk);
    const lines = logLines().filter((l) => l.id === body.id);
    assert.ok(lines.some((l) => l.event === "created"));
    assert.ok(lines.some((l) => l.state === "answered"));
    for (const line of lines) {
      assert.equal(line.sessionId, SESSION);
      assert.equal(line.desk, desk);
    }
  }
});

test("desk passes through without a sessionId", async () => {
  const { ring, calls, logLines } = rig();
  const ws = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", desk: true });
  await tick();
  assert.equal(ws.of("ring")[0].desk, true);
  assert.equal(ws.of("ring")[0].dropOk, true);
  assert.equal(calls.post[0].body.desk, true);
  ws.say({ type: "ring_answer", id: body.id });
  assert.equal(ws.of("ring_go")[0].desk, true);
  assert.ok(logLines().filter((l) => l.id === body.id).every((l) => l.sessionId === null && l.desk === true));
});

test("cell fallback forwards sessionId and desk to voice-dump", async () => {
  const { ring, calls } = rig();
  ring.create({ topic: "T", brief: "B", urgency: "urgent", sessionId: SESSION, desk: true });
  await tick();
  assert.deepEqual(calls.post.find((c) => c.url.includes("/tw/ring")).body, {
    instruct: "T: B", sessionId: SESSION, desk: true,
  });
});

test("no-session ring preserves the previous message shape plus dropOk true", async () => {
  const { ring, clock, logLines } = rig();
  const ws = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", from: "f" });
  await tick();
  assert.deepEqual(ws.of("ring")[0], {
    type: "ring", id: body.id, topic: "T", from: "f", urgency: "routine",
    expiresAt: clock.t + 40, ttlMs: 40, dropOk: true,
  });
  ws.say({ type: "ring_answer", id: body.id });
  assert.deepEqual(ws.of("ring_outcome")[0], {
    type: "ring_outcome", ringId: body.id, sessionId: null, outcome: "answered", at: new Date(clock.t).toISOString(),
  });
  assert.ok(logLines().filter((l) => l.id === body.id).every((l) => l.sessionId === null && l.desk === false));
  ring.create({ topic: "Again", from: "f" });
  await tick();
  assert.equal(ws.of("ring")[1].dropOk, true);
});

test("dropOk allows one ring per session per 15 minutes, with independent sessions", async () => {
  const { ring, clock } = rig({ opts: { timeouts: { routine: 60_000 } } });
  const ws = device(ring, "dev-laptop-1");
  const send = async (sessionId, from = "f") => {
    const { status, body } = ring.create({ topic: "T", from, sessionId });
    assert.equal(status, 202);
    await tick();
    const message = ws.of("ring").find((m) => m.id === body.id);
    ws.say({ type: "ring_answer", id: body.id });
    return message.dropOk;
  };
  assert.equal(await send(SESSION), true);
  clock.t += 15 * 60_000 - 1;
  assert.equal(await send(SESSION, "other"), false);
  assert.equal(await send(OTHER_SESSION), true);
  clock.t += 1;
  assert.equal(await send(SESSION), true);
});

test("a ring uses one drop allowance across devices and late arrivals", async () => {
  const { ring } = rig();
  const a = device(ring, "dev-laptop-1");
  const b = device(ring, "dev-phone-01");
  const first = ring.create({ topic: "T", sessionId: SESSION });
  await tick();
  const c = device(ring, "dev-tablet-1");
  for (const ws of [a, b, c]) assert.equal(ws.of("ring")[0].dropOk, true);
  a.say({ type: "ring_answer", id: first.body.id });
  const second = ring.create({ topic: "T", sessionId: SESSION });
  await tick();
  for (const ws of [a, b, c]) assert.equal(ws.of("ring")[1].dropOk, false);
  a.say({ type: "ring_answer", id: second.body.id });
});

test("no presence or a failed brief does not consume the session drop allowance", async () => {
  let fail = true;
  const { ring } = rig({ post: () => ({ ok: !fail, status: fail ? 500 : 200 }) });
  ring.create({ topic: "T", sessionId: SESSION });
  await tick();
  const ws = device(ring, "dev-laptop-1");
  ring.create({ topic: "T", sessionId: SESSION });
  await tick();
  assert.equal(ws.of("ring").length, 0);
  fail = false;
  const { body } = ring.create({ topic: "T", sessionId: SESSION });
  await tick();
  assert.equal(ws.of("ring")[0].dropOk, true);
  ws.say({ type: "ring_answer", id: body.id });
});

test("concurrent brief posts cannot both take the session drop allowance", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { ring } = rig({ post: async () => { await gate; return { ok: true, status: 200 }; } });
  const ws = device(ring, "dev-laptop-1");
  const a = ring.create({ topic: "A", sessionId: SESSION });
  const b = ring.create({ topic: "B", sessionId: SESSION });
  release();
  await tick();
  assert.deepEqual(ws.of("ring").map((m) => m.dropOk), [true, false]);
  ws.say({ type: "ring_answer", id: a.body.id });
  ws.say({ type: "ring_answer", id: b.body.id });
});

test("ring outcomes broadcast to all dashboard sockets with sessionId and the injected time", async () => {
  const { ring, clock } = rig();
  const a = device(ring, "dev-laptop-1");
  const b = device(ring, "dev-phone-01");
  const viewer = new FakeWs(); ring.attach(viewer);
  const { body } = ring.create({ topic: "T", sessionId: SESSION });
  await tick();
  a.say({ type: "ring_later", id: body.id });
  b.say({ type: "ring_answer", id: body.id });
  const expected = ["later", "answered"].map((outcome) => ({
    type: "ring_outcome", ringId: body.id, sessionId: SESSION, outcome, at: new Date(clock.t).toISOString(),
  }));
  for (const ws of [a, b, viewer]) assert.deepEqual(ws.of("ring_outcome"), expected);
});

test("state changes and later use the injectable dashboard broadcaster", async () => {
  const messages = [];
  const { ring } = rig({ opts: { broadcast: (m) => messages.push(m) } });
  const ws = device(ring, "dev-laptop-1");
  const { body } = ring.create({ topic: "T", sessionId: SESSION });
  await tick();
  ws.say({ type: "ring_later", id: body.id });
  await tick();
  assert.deepEqual(messages.map((m) => m.outcome), ["later", "declined", "fallback_telegram"]);
  assert.ok(messages.every((m) => m.type === "ring_outcome" && m.ringId === body.id && m.sessionId === SESSION));
  assert.equal(ws.of("ring_outcome").length, 0);
});

test("timeout and all fallback states broadcast their existing outcome names", async () => {
  for (const [over, urgency, expected] of [
    [{}, "routine", ["timeout", "fallback_telegram"]],
    [{}, "urgent", ["timeout", "fallback_cell"]],
    [{ tgFail: true }, "routine", ["timeout", "fallback_failed"]],
    [{ post: () => ({ ok: false, status: 500 }) }, "routine", ["no_presence", "fallback_telegram"]],
  ]) {
    const { ring } = rig(over);
    const ws = device(ring, "dev-laptop-1");
    const { body } = ring.create({ topic: "T", sessionId: SESSION, urgency });
    await tick(80);
    assert.deepEqual(ws.of("ring_outcome").map((m) => m.outcome), expected);
    assert.ok(ws.of("ring_outcome").every((m) => m.ringId === body.id && m.sessionId === SESSION));
  }
  const { ring } = rig();
  const viewer = new FakeWs(); ring.attach(viewer);
  ring.create({ topic: "T", sessionId: SESSION });
  await tick();
  assert.deepEqual(viewer.of("ring_outcome").map((m) => m.outcome), ["no_presence", "fallback_telegram"]);
});
