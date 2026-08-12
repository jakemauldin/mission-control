import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
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

dotenv.config({ path: join(import.meta.dirname, ".env") });
dotenv.config({ path: join(import.meta.dirname, "..", ".env") });

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3080;

app.use(cors());
app.use(express.json());

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
app.get("/api/claw/status", (_req, res) => {
  const result = execDockerJSON("openclaw status --json");
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  res.json({ ok: true, data: result.data });
});

// ── OpenClaw insights ────────────────────────────────────────
app.get("/api/insights", (_req, res) => {
  const result = execDocker("cat /home/node/.openclaw/workspace/INSIGHTS.md");
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  res.json({ ok: true, data: result.data });
});

// ── OpenClaw expertise ───────────────────────────────────────
app.get("/api/expertise", (_req, res) => {
  const result = execDocker("cat /home/node/.openclaw/workspace/EXPERTISE.md");
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  res.json({ ok: true, data: result.data });
});

// ── OpenClaw crons ───────────────────────────────────────────
app.get("/api/crons", (_req, res) => {
  const result = execDockerJSON("cat /home/node/.openclaw/cron/jobs.json");
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  res.json({ ok: true, data: result.data });
});

// ── Intelligence daily brief ─────────────────────────────────
app.get("/api/intelligence/today", (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const result = execDocker(
    `cat /home/node/.openclaw/workspace/memory/intelligence/brief-${today}.md`
  );
  if (!result.ok) {
    return res.json({ ok: false, fallback: true, error: result.error });
  }
  res.json({ ok: true, data: result.data, date: today });
});

// ── Dispatch command to OpenClaw ─────────────────────────────
app.post("/api/claw/dispatch", (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== "string") {
    return res.status(400).json({ ok: false, error: "command is required" });
  }
  // Sanitize: allow only safe characters
  const sanitized = command.replace(/[^a-zA-Z0-9 _\-.,/'"@#:=]/g, "");
  const result = execDocker(`openclaw ${sanitized}`);
  if (!result.ok) {
    return res.json({ ok: false, error: result.error });
  }
  res.json({ ok: true, data: result.data });
});

// ── AI costs (parse from daily brief or dedicated file) ──────
app.get("/api/costs", (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const result = execDocker(
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
    const num = parseInt(req.params.num);
    const app = updateApplication(req.params.id, num, req.body.lineItems);
    res.json({ ok: true, data: app });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Update application metadata (periodTo, etc.)
app.patch("/api/billing/jobs/:id/apps/:num", (req, res) => {
  try {
    const num = parseInt(req.params.num);
    const app = updateApplicationMeta(req.params.id, num, req.body);
    res.json({ ok: true, data: app });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Finalize application
app.post("/api/billing/jobs/:id/apps/:num/finalize", (req, res) => {
  try {
    const num = parseInt(req.params.num);
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
    const num = parseInt(req.params.num);
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
    const num = parseInt(req.params.num);

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
const wss = new WebSocketServer({ server, path: "/ws" });
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

// Periodic health poll → push to clients
let lastHealthHash = "";
setInterval(async () => {
  if (clients.size === 0) return;

  // Poll claw status
  const clawResult = execDockerJSON("openclaw status --json");
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

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`⚡ Rising Creek API → http://localhost:${PORT}`);
  console.log(`   WebSocket → ws://localhost:${PORT}/ws`);
  console.log(`   JobTread key: ${process.env.JOBTREAD_GRANT_KEY ? "✓ loaded" : "✗ missing"}`);
  console.log(`   OpenClaw container: ${process.env.OPENCLAW_CONTAINER || "openclaw"}`);
});
