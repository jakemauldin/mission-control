import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { requireAuth, checkPassphrase, makeSessionCookie, clearSessionCookie, validSession } from "./lib/auth.js";
import { buildBrief, snoozeItem, invalidateBrief } from "./lib/brief.js";
import { listRfiJobs, getRfi, mediaCounts, updateRfiItem, recentMedia, thumbPathFor } from "./lib/rfis.js";
import { systemsOutcomes } from "./lib/systems.js";
import { createGenRequest, listGenRequests } from "./lib/gen.js";
import { createPost, listPosts, updatePostStatus } from "./lib/posts.js";
import { suggestPosts, recordSuggestionFeedback } from "./lib/suggest.js";
import { unfurl } from "./lib/unfurl.js";
import chokidar from "chokidar";
import { homedir } from "os";
import { execDocker, execDockerJSON } from "./lib/docker.js";
import { getJobs, getJobDetail } from "./lib/jobtread.js";
import {
  getSettings, saveSettings,
  loadJobBilling, saveJobBilling,
  fetchScheduleOfValues,
  createApplication, updateApplication, updateApplicationMeta, finalizeApplication,
  calculateApplication,
  generateG702Pdf, generateG703Pdf,
  createPdfBuffer,
} from "./lib/billing.js";
import dotenv from "dotenv";
import { getProjects, createProject, updateProject, addTodo, updateTodo, deleteTodo, slugify } from "./lib/projects.js";

dotenv.config({ path: join(import.meta.dirname, ".env") });
dotenv.config({ path: join(import.meta.dirname, "..", ".env") });

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3080;

app.use(express.json());

// ── Auth (DESIGN.md §7) ──────────────────────────────────────
// Everything under /api requires a session except login and a minimal probe.
app.post("/api/login", (req, res) => {
  if (!checkPassphrase(req.body?.passphrase)) {
    return res.status(401).json({ ok: false, error: "wrong passphrase" });
  }
  res.setHeader("Set-Cookie", makeSessionCookie());
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});
// Status word only — no file contents, no versions. Safe unauthenticated.
app.get("/api/health/probe", (_req, res) => res.json({ ok: true }));
app.use("/api", requireAuth);

// ── Projects: per-project running to-do w/ progress dates (2026-08-16) ──
// Store: ~/services/projects/projects.json (+ IN-FLIGHT.md headings/plate, read-only).
app.get("/api/projects", (_req, res) => {
  try { res.json(getProjects()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/projects", (req, res) => {
  const { name, status, progressNote } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  try { res.json(createProject({ name, status, progressNote })); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch("/api/projects/:id", (req, res) => {
  try { res.json(updateProject(req.params.id, req.body || {})); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/projects/:id/todos", (req, res) => {
  const { text, name, by } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });
  try { res.json(addTodo(req.params.id, text, { name, by })); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch("/api/projects/:id/todos/:tid", (req, res) => {
  try {
    const t = updateTodo(req.params.id, req.params.tid, req.body || {});
    if (!t) return res.status(404).json({ error: "not found" });
    res.json(t);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/projects/:id/todos/:tid", (req, res) => {
  try { res.json({ ok: deleteTodo(req.params.id, req.params.tid) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/projects/slug/:name", (req, res) => res.json({ id: slugify(req.params.name) }));

// ── Health: read latest health-*.log ─────────────────────────
app.get("/api/health", (_req, res) => {
  try {
    const logDir = join(homedir(), "services", "logs");
    const files = readdirSync(logDir)
      .filter((f) => f.startsWith("health-") && f.endsWith(".log"))
      .sort()
      .reverse();

    if (files.length === 0) {
      return res.json({ ok: false, fallback: true, error: "No health logs found" });
    }

    const content = readFileSync(join(logDir, files[0]), "utf-8");
    // Try to parse as JSON, otherwise return raw
    try {
      const data = JSON.parse(content);
      res.json({ ok: true, data, file: files[0] });
    } catch {
      res.json({ ok: true, data: content, file: files[0] });
    }
  } catch (err) {
    res.json({ ok: false, fallback: true, error: err.message });
  }
});

// ── Jobs: proxy to JobTread Pave API ─────────────────────────
app.get("/api/jobs", async (_req, res) => {
  const result = await getJobs();
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  res.json({ ok: true, data: result.data });
});

// ── OpenClaw status ──────────────────────────────────────────
app.get("/api/claw/status", async (_req, res) => {
  const result = await execDockerJSON("openclaw status --json");
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  res.json({ ok: true, data: result.data });
});

// ── OpenClaw insights ────────────────────────────────────────
app.get("/api/insights", async (_req, res) => {
  const result = await execDocker("cat /home/node/.openclaw/workspace/INSIGHTS.md");
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  res.json({ ok: true, data: result.data });
});

// ── OpenClaw expertise ───────────────────────────────────────
app.get("/api/expertise", async (_req, res) => {
  const result = await execDocker("cat /home/node/.openclaw/workspace/EXPERTISE.md");
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  res.json({ ok: true, data: result.data });
});

// ── OpenClaw crons ───────────────────────────────────────────
app.get("/api/crons", async (_req, res) => {
  const result = await execDockerJSON("cat /home/node/.openclaw/cron/jobs.json");
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  res.json({ ok: true, data: result.data });
});

// ── Intelligence daily brief ─────────────────────────────────
app.get("/api/intelligence/today", async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const result = await execDocker(
    `cat /home/node/.openclaw/workspace/memory/intelligence/brief-${today}.md`
  );
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  res.json({ ok: true, data: result.data, date: today });
});

// ── Dispatch command to OpenClaw ─────────────────────────────
app.post("/api/claw/dispatch", async (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== "string") {
    return res.status(400).json({ ok: false, error: "command is required" });
  }
  // Allowlist of subcommands (DESIGN.md §7). The old character denylist blocked shell
  // metacharacters but happily forwarded `openclaw config set ...` — auth says who may
  // call this, the allowlist says what it can do. Both are required.
  const ALLOWED = ["status", "health", "logs", "agents list", "mcp list", "cron list"];
  const sanitized = command.replace(/[^a-zA-Z0-9 _\-.,/'"@#:=]/g, "").trim();
  if (!ALLOWED.some((a) => sanitized === a || sanitized.startsWith(a + " "))) {
    return res.status(403).json({ ok: false, error: `subcommand not in allowlist: ${ALLOWED.join(", ")}` });
  }
  const result = await execDocker(`openclaw ${sanitized}`, { cacheMs: 0 });
  if (!result.ok) {
    return res.json({ ok: false, error: result.error });
  }
  res.json({ ok: true, data: result.data });
});

// ── AI costs (parse from daily brief or dedicated file) ──────
app.get("/api/costs", async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const result = await execDocker(
    `cat /home/node/.openclaw/workspace/memory/intelligence/brief-${today}.md`
  );
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  // Try to extract cost section from brief
  const costMatch = result.data.match(/## (?:Cost|Spend|Token)[\s\S]*?(?=\n## |\n$|$)/i);
  res.json({ ok: true, data: costMatch ? costMatch[0] : null, raw: result.data });
});

// ── Billing: G702/G703 Commercial Billing ────────────────────

// Settings
app.get("/api/billing/settings", (_req, res) => {
  res.json({ ok: true, data: getSettings() });
});

app.put("/api/billing/settings", (req, res) => {
  const settings = saveSettings(req.body);
  res.json({ ok: true, data: settings });
});

// Get schedule of values for a job (from JobTread)
app.get("/api/billing/jobs/:id/sov", async (req, res) => {
  try {
    const sov = await fetchScheduleOfValues(req.params.id, getJobDetail);
    const billing = loadJobBilling(req.params.id);
    res.json({ ok: true, data: { ...sov, billing } });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Get billing state for a job
app.get("/api/billing/jobs/:id", (req, res) => {
  const billing = loadJobBilling(req.params.id);
  res.json({ ok: true, data: billing });
});

// Create new application
app.post("/api/billing/jobs/:id/apps", (req, res) => {
  try {
    const app = createApplication(req.params.id, {
      periodTo: req.body.periodTo,
      jobName: req.body.jobName,
      jobNumber: req.body.jobNumber,
    });
    res.json({ ok: true, data: app });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Update application line items
app.put("/api/billing/jobs/:id/apps/:num", (req, res) => {
  try {
    const num = parseInt(req.params.num, 10);
    if (Number.isNaN(num)) throw new Error("application number must be an integer");
    const app = updateApplication(req.params.id, num, req.body.lineItems);
    res.json({ ok: true, data: app });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Update application metadata (periodTo, etc.)
app.patch("/api/billing/jobs/:id/apps/:num", (req, res) => {
  try {
    const num = parseInt(req.params.num, 10);
    if (Number.isNaN(num)) throw new Error("application number must be an integer");
    const app = updateApplicationMeta(req.params.id, num, req.body);
    res.json({ ok: true, data: app });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Finalize application
app.post("/api/billing/jobs/:id/apps/:num/finalize", (req, res) => {
  try {
    const num = parseInt(req.params.num, 10);
    if (Number.isNaN(num)) throw new Error("application number must be an integer");
    const app = finalizeApplication(req.params.id, num);
    res.json({ ok: true, data: app });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Generate PDF (type = g702, g703, or combined)
async function handlePdfGeneration(req, res) {
  try {
    const jobId = req.params.id;
    const num = parseInt(req.params.num, 10);
    if (Number.isNaN(num)) throw new Error("application number must be an integer");
    const type = req.params.type || "combined";

    // Fetch current SOV from JT
    const sov = await fetchScheduleOfValues(jobId, getJobDetail);
    const billing = loadJobBilling(jobId);
    if (!billing) throw new Error("No billing data for this job");

    const appMeta = billing.applications.find((a) => a.number === num);
    if (!appMeta) throw new Error(`Application #${num} not found`);

    // Calculate everything
    const calc = calculateApplication(sov.lines, billing, num);

    if (type === "g702") {
      const docDef = generateG702Pdf(calc, sov.job, appMeta);
      const buf = await createPdfBuffer(docDef);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="G702-${sov.job.name}-App${num}.pdf"`);
      res.send(buf);
    } else if (type === "g703") {
      const docDef = generateG703Pdf(calc, sov.job, appMeta);
      const buf = await createPdfBuffer(docDef);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="G703-${sov.job.name}-App${num}.pdf"`);
      res.send(buf);
    } else {
      // Combined — generate both, return G702 (portrait) first
      // Since pdfmake can't mix orientations, return G702
      // Frontend will offer separate download buttons
      const g702Doc = generateG702Pdf(calc, sov.job, appMeta);
      const buf = await createPdfBuffer(g702Doc);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="G702-${sov.job.name}-App${num}.pdf"`);
      res.send(buf);
    }
  } catch (err) {
    console.error("PDF generation error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

app.get("/api/billing/jobs/:id/apps/:num/pdf/:type", handlePdfGeneration);
app.get("/api/billing/jobs/:id/apps/:num/pdf", handlePdfGeneration);

// Calculate application (for live preview without generating PDF)
app.post("/api/billing/jobs/:id/apps/:num/calculate", async (req, res) => {
  try {
    const jobId = req.params.id;
    const num = parseInt(req.params.num, 10);
    if (Number.isNaN(num)) throw new Error("application number must be an integer");

    const sov = await fetchScheduleOfValues(jobId, getJobDetail);
    const billing = loadJobBilling(jobId);
    if (!billing) throw new Error("No billing data");

    // Temporarily apply the request body line items for preview
    const appIdx = billing.applications.findIndex((a) => a.number === num);
    if (appIdx === -1) throw new Error(`App #${num} not found`);
    if (req.body.lineItems) {
      billing.applications[appIdx].lineItems = req.body.lineItems;
    }

    const calc = calculateApplication(sov.lines, billing, num);
    res.json({ ok: true, data: calc });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Brief (home action queue, DESIGN.md §2) ──────────────────
app.get("/api/brief", async (_req, res) => {
  try { res.json({ ok: true, data: await buildBrief() }); }
  catch (e) { res.json({ ok: false, fallback: true, error: e.message }); }
});
app.post("/api/brief/snooze", (req, res) => {
  const { key, until } = req.body || {};
  if (!key || !until) return res.status(400).json({ ok: false, error: "key and until required" });
  try { res.json({ ok: true, data: snoozeItem(key, until) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── RFIs (read-only, DESIGN.md §4) + media counts ────────────
app.get("/api/rfis", (_req, res) => {
  try { res.json({ ok: true, data: listRfiJobs() }); } catch (e) { res.json({ ok: false, error: e.message }); }
});
app.get("/api/rfis/:jobId", (req, res) => {
  const rfi = getRfi(req.params.jobId);
  if (!rfi) return res.status(404).json({ ok: false, error: "no rfi.json for that job" });
  res.json({ ok: true, data: rfi });
});
// Phase 2: the narrow RFI write path — exactly two fields (DESIGN.md §4)
app.patch("/api/rfis/:jobId/items/:itemId", (req, res) => {
  const { status, note } = req.body || {};
  if (status === undefined && !note) return res.status(400).json({ ok: false, error: "status or note required" });
  const r = updateRfiItem(req.params.jobId, req.params.itemId, { status, note });
  if (r.error) return res.status(400).json({ ok: false, error: r.error });
  res.json({ ok: true, data: r.item });
});

// Systems outcomes (DESIGN.md §6) — replaces /api/crons' scheduler-list reading
app.get("/api/systems/outcomes", async (_req, res) => {
  try { res.json({ ok: true, data: await systemsOutcomes() }); } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Job detail (DESIGN.md §10 phase 2): JT overview + RFI counts + pay-app state
app.get("/api/jobs/:id/detail", async (req, res) => {
  try {
    const [jt, rfis] = await Promise.all([getJobDetail(req.params.id), Promise.resolve(listRfiJobs())]);
    let payApps = null;
    try {
      const b = loadJobBilling(req.params.id);
      payApps = (b?.applications || []).map(a => ({ number: a.number, status: a.finalizedAt ? "finalized" : "draft", periodTo: a.periodTo }));
    } catch { /* no billing store for job */ }
    // ID bridge: JT uses long string ids, RFI dirs use Jake's internal job numbers.
    // Match directly first, else extract the number from the JT job name ("... #119 ...").
    let rfi = rfis.find(r => r.jobId === String(req.params.id)) || null;
    if (!rfi) {
      const jtName = jt?.data?.job?.name || jt?.job?.name || "";
      const m = /\b(\d{2,3})\b/.exec(jtName);
      if (m) rfi = rfis.find(r => r.jobId === m[1]) || null;
    }
    res.json({ ok: jt.ok !== false, data: { jt: jt.data || jt, rfi, payApps } });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Media generation dispatch (DESIGN.md §3 — intent only, Fable authors prompts)
app.post("/api/media/generate", (req, res) => {
  try { res.json({ ok: true, data: createGenRequest(req.body || {}) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get("/api/media/generate", (_req, res) => {
  try { res.json({ ok: true, data: listGenRequests() }); } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get("/api/media/recent", (req, res) => {
  try { res.json({ ok: true, data: recentMedia(req.query.bucket || "postable", Math.min(60, parseInt(req.query.n, 10) || 24)) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
// Serves ONLY from the _thumbs cache. The rel is flattened to a cache key (all
// non-alnum → "_"), so traversal cannot escape the thumbs dir by construction.
app.get("/api/media/thumb", (req, res) => {
  const p = thumbPathFor(req.query.rel || "");
  res.sendFile(p, (err) => { if (err) res.status(404).end(); });
});

// AI suggestions — one metered sonnet call per click (~1-2¢), learning from the
// suggestions log + Jake's queued posts. 30s timeout so a slow call can't hang the UI.
app.post("/api/media/suggest", async (_req, res) => {
  try { res.json({ ok: true, data: await suggestPosts() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post("/api/media/suggest/feedback", (req, res) => {
  try { res.json({ ok: true, data: recordSuggestionFeedback(req.body || {}) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/api/media/unfurl", async (req, res) => {
  try { res.json({ ok: true, data: await unfurl(req.query.url || "") }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post("/api/media/posts", (req, res) => {
  try { res.json({ ok: true, data: createPost(req.body || {}) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.patch("/api/media/posts/:id", async (req, res) => {
  const r = await updatePostStatus(req.params.id, req.body?.status);
  if (r.error) return res.status(400).json({ ok: false, error: r.error });
  res.json({ ok: true, data: r.post });
});
app.get("/api/media/posts", (_req, res) => {
  try { res.json({ ok: true, data: listPosts() }); } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get("/api/media/counts", (_req, res) => {
  try { res.json({ ok: true, data: mediaCounts() }); } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── AP workflow (Path A) — proxy to integration-api ──────────
// Two-path AP design (2026-05-18): planned vendor payments must have a JT
// vendor bill OPEN before the wire arrives. The pending-bills queue and
// open-bills view live in integration-api; we just proxy through.
// integration-api runs in the openclaw stack on the risingcreek-net bridge.
// From the host, it's reachable at the container's IP (172.18.0.7) — not localhost.
const INTEGRATION_API = process.env.INTEGRATION_API_URL || "http://172.18.0.7:3090";

async function proxyToIntegration(req, res, path, opts = {}) {
  try {
    const init = {
      method: opts.method || req.method,
      headers: { "Content-Type": "application/json" }
    };
    if (init.method !== "GET" && init.method !== "HEAD") {
      init.body = JSON.stringify(req.body || {});
    }
    const r = await fetch(`${INTEGRATION_API}${path}`, init);
    const txt = await r.text();
    res.status(r.status);
    res.type("application/json").send(txt);
  } catch (err) {
    res.status(502).json({ ok: false, error: "integration-api unreachable: " + err.message });
  }
}

app.get("/api/ap/pending-bills", (req, res) => proxyToIntegration(req, res, "/api/pending-bills"));
app.post("/api/ap/pending-bills/manual", (req, res) => proxyToIntegration(req, res, "/api/pending-bills/manual"));
app.post("/api/ap/pending-bills/:id/confirm", (req, res) => proxyToIntegration(req, res, `/api/pending-bills/${req.params.id}/confirm`));
app.post("/api/ap/pending-bills/:id/reject", (req, res) => proxyToIntegration(req, res, `/api/pending-bills/${req.params.id}/reject`));
app.get("/api/ap/open-bills", (req, res) => proxyToIntegration(req, res, "/api/open-bills"));
app.post("/api/ap/match-wire", (req, res) => proxyToIntegration(req, res, "/api/open-bills/match-wire"));

// ── Land Finder — proxy to property-finder-mcp (:3220) ───────
// Property deal-sourcing connector (Zillow on-market land). Runs as a local
// container/process bound to 127.0.0.1:3220 (host-reachable since this API is
// a host process). Read-only listing data; no secrets pass through here.
const LAND_API = process.env.LAND_API_URL || "http://127.0.0.1:3220";
function proxyLand(path) {
  return async (req, res) => {
    try {
      const qs = new URLSearchParams(req.query).toString();
      const r = await fetch(`${LAND_API}${path}${qs ? "?" + qs : ""}`);
      const txt = await r.text();
      res.status(r.status).type("application/json").send(txt);
    } catch (err) {
      res.status(502).json({ ok: false, fallback: true, error: "land service unreachable: " + err.message });
    }
  };
}
app.get("/api/land", proxyLand("/land"));            // on-market listings (Zillow)
app.get("/api/offmarket", proxyLand("/offmarket"));  // off-market motivated-owner parcels (RealEstateAPI)
app.get("/api/foreclosures", proxyLand("/foreclosures")); // distress pipeline (RealEstateAPI)

// ── WebSocket for real-time push ─────────────────────────────
const wss = new WebSocketServer({
  server,
  path: "/ws",
  // Same session cookie as /api — an unauthenticated socket gets no push data.
  verifyClient: ({ req }) => validSession(req.headers.cookie),
});
const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "connected", time: new Date().toISOString() }));

  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

// ── chokidar watchers → topic-tagged pushes (DESIGN.md §2/§4) ────────────────
// A change to any job's rfi.json — from the dashboard, Jake's editor, or the
// voice-dump merge — pushes rfi:<jobId> and refreshes the Brief. Debounced per file.
try {
  const rfiGlob = join(homedir(), "services", "rising-creek", "jobs");
  const debounces = new Map();
  chokidar.watch(rfiGlob, { depth: 2, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 400 } })
    .on("all", (_ev, fp) => {
      if (!fp.endsWith("rfi.json")) return;
      clearTimeout(debounces.get(fp));
      debounces.set(fp, setTimeout(() => {
        const jobId = fp.split("/").slice(-2)[0].split("-")[0];
        invalidateBrief();
        broadcast({ type: "rfi_update", topic: `rfi:${jobId}`, jobId, time: new Date().toISOString() });
        broadcast({ type: "brief_update", topic: "brief:queue", time: new Date().toISOString() });
      }, 250));
    });
  const genDir = join(import.meta.dirname, "data", "media-gen-queue");
  chokidar.watch(genDir, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 400 } })
    .on("all", () => broadcast({ type: "gen_update", topic: "media:gen", time: new Date().toISOString() }));
} catch (e) { console.warn("watcher setup failed:", e.message); }

// Periodic health poll → push to clients
let lastHealthHash = "";
setInterval(async () => {
  if (clients.size === 0) return;

  // Poll claw status
  const clawResult = await execDockerJSON("openclaw status --json");
  if (clawResult.ok) {
    const hash = JSON.stringify(clawResult.data);
    if (hash !== lastHealthHash) {
      lastHealthHash = hash;
      broadcast({ type: "claw_update", data: clawResult.data, time: new Date().toISOString() });
    }
  }

  // Poll health logs
  try {
    const logDir = join(homedir(), "services", "logs");
    const files = readdirSync(logDir)
      .filter((f) => f.startsWith("health-") && f.endsWith(".log"))
      .sort()
      .reverse();
    if (files.length > 0) {
      const content = readFileSync(join(logDir, files[0]), "utf-8");
      broadcast({ type: "health_update", data: content, file: files[0], time: new Date().toISOString() });
    }
  } catch {
    // Silently ignore — health logs may not exist
  }
}, 30_000);

// ── Static build (DESIGN.md §7: one process serves dist/ + /api + /ws) ──
const DIST = join(import.meta.dirname, "..", "dist");
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA fallback: any non-API GET serves index.html so react-router owns the URL.
  app.get(/^\/(?!api\/|ws$).*/, (_req, res) => res.sendFile(join(DIST, "index.html")));
} else {
  console.warn("⚠ dist/ not built — API-only mode (run `npm run build`)");
}

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`⚡ Rising Creek API → http://localhost:${PORT}`);
  console.log(`   WebSocket → ws://localhost:${PORT}/ws`);
  console.log(`   JobTread key: ${process.env.JOBTREAD_GRANT_KEY ? "✓ loaded" : "✗ missing"}`);
  console.log(`   OpenClaw container: ${process.env.OPENCLAW_CONTAINER || "openclaw"}`);
});
