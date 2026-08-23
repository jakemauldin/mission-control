// Generation dispatch queue (DESIGN.md §3). The dashboard NEVER authors a prompt and
// NEVER calls Higgsfield. It writes intent files; Jake's Fable session composes the
// prompt and dispatches through the existing pipelines, updating status in the file.
// Statuses: awaiting-prompt → queued → running → done | failed.
import { readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

const QDIR = join(import.meta.dirname, "..", "data", "media-gen-queue");

export function createGenRequest({ type, aspect, jobContext, intent, refs }) {
  mkdirSync(QDIR, { recursive: true });
  const id = `${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
  const req = {
    id, status: "awaiting-prompt", created: new Date().toISOString(),
    type: String(type || "still"), aspect: String(aspect || "16x9"),
    jobContext: String(jobContext || ""), intent: String(intent || "").slice(0, 4000),
    refs: Array.isArray(refs) ? refs.slice(0, 20).map(String) : [],
  };
  const f = join(QDIR, `${id}.json`);
  writeFileSync(f + ".tmp", JSON.stringify(req, null, 2));
  renameSync(f + ".tmp", f);
  // The copy-to-clipboard brief for Jake's Fable session
  req.brief = [
    `MEDIA GEN REQUEST ${id}`,
    `type: ${req.type} · aspect: ${req.aspect} · job: ${req.jobContext || "-"}`,
    `intent: ${req.intent}`,
    req.refs.length ? `refs: ${req.refs.join(", ")}` : "refs: none",
    `queue file: ~/Dashboard/mission-control/server/data/media-gen-queue/${id}.json`,
    `(compose the prompt in-session, dispatch via the higgsfield pipeline, update "status" in the file)`,
  ].join("\n");
  return req;
}

export function listGenRequests() {
  if (!existsSync(QDIR)) return [];
  return readdirSync(QDIR).filter(f => f.endsWith(".json")).sort().reverse().slice(0, 50)
    .map(f => { try { return JSON.parse(readFileSync(join(QDIR, f), "utf-8")); } catch { return null; } })
    .filter(Boolean);
}
