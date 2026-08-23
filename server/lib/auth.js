// Session auth for the internal dashboard (DESIGN.md §7).
//
// Why this exists: until 2026-08-23 the :3080 API had NO auth — anything on the
// tailnet (or LAN, subject to ufw) could read job costs and POST to /api/claw/dispatch.
// One known user (Jake), so a single passphrase + signed HttpOnly cookie is the right
// size; a full IdP would be overkill. The client portal (separate process, §5) shares
// NO code with this on purpose.
//
// Secrets come from BWS via start.sh env injection:
//   MISSION_CONTROL_PASSPHRASE      what Jake types at /login
//   MISSION_CONTROL_SESSION_SECRET  HMAC key for the session cookie
// If either is missing we FAIL CLOSED: every request 401s rather than running open.

import { createHmac, timingSafeEqual } from "crypto";

const COOKIE = "mc_session";
const TTL_MS = 30 * 24 * 3600 * 1000; // 30 days; cookie is HttpOnly + SameSite=Strict

const PASSPHRASE = process.env.MISSION_CONTROL_PASSPHRASE || "";
const SECRET = process.env.MISSION_CONTROL_SESSION_SECRET || "";

function sign(exp) {
  return createHmac("sha256", SECRET).update(String(exp)).digest("base64url");
}

export function makeSessionCookie() {
  const exp = Date.now() + TTL_MS;
  const val = `${exp}.${sign(exp)}`;
  return `${COOKIE}=${val}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(TTL_MS / 1000)}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

// Parse the session cookie out of a raw Cookie header. No cookie-parser dep needed.
export function validSession(cookieHeader) {
  if (!SECRET) return false; // fail closed
  const m = /(?:^|;\s*)mc_session=([^;]+)/.exec(cookieHeader || "");
  if (!m) return false;
  const [expStr, sig] = m[1].split(".");
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function checkPassphrase(input) {
  if (!PASSPHRASE) return false; // fail closed
  const want = Buffer.from(PASSPHRASE);
  const got = Buffer.from(String(input || ""));
  return want.length === got.length && timingSafeEqual(want, got);
}

// Express middleware for /api/*. /api/login and /api/health/probe are exempted
// where this is mounted, not here — keep the middleware itself unconditional.
export function requireAuth(req, res, next) {
  if (validSession(req.headers.cookie)) return next();
  res.status(401).json({ ok: false, error: "auth required" });
}
