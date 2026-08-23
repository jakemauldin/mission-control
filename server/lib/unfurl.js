// Link unfurl for the post-builder previews: fetch the pasted URL's Open Graph
// data (image, title, description, site name, favicon) so link cards render the
// way the platform actually would.
//
// SSRF GUARD — this endpoint fetches attacker-suppliable URLs from a host that
// sits on a tailnet with real internal services. Before fetching we resolve the
// hostname and refuse anything private/reserved: loopback, RFC1918, link-local
// (169.254.* — the DO metadata endpoint lives there), and CGNAT 100.64/10,
// which is Tailscale's range. Auth already gates the route; this is depth.
import { lookup } from "dns/promises";

const cache = new Map(); // url -> {at, data}
const TTL = 3600_000;

function ipBlocked(ip) {
  if (ip.includes(":")) return ip === "::1" || ip.startsWith("fe80") || ip.startsWith("fc") || ip.startsWith("fd");
  const [a, b] = ip.split(".").map(Number);
  return a === 127 || a === 10 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

function pick(html, re) {
  const m = re.exec(html);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim() : null;
}

export async function unfurl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("not a URL"); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("http(s) only");
  const hit = cache.get(u.href);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const { address } = await lookup(u.hostname);
  if (ipBlocked(address)) throw new Error("host not allowed");

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  let html = "";
  try {
    const r = await fetch(u.href, {
      signal: ctl.signal, redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" },
    });
    const reader = r.body.getReader();
    while (html.length < 512 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      html += Buffer.from(value).toString("utf-8");
      if (/<\/head>/i.test(html)) break; // OG lives in <head>; stop early
    }
    reader.cancel().catch(() => {});
  } finally { clearTimeout(t); }

  const og = (p) => pick(html, new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)["']`, "i"))
             || pick(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${p}["']`, "i"));
  let icon = pick(html, /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i) || "/favicon.ico";
  const data = {
    url: u.href, domain: u.hostname.replace(/^www\./, ""),
    title: og("title") || pick(html, /<title[^>]*>([^<]+)<\/title>/i) || u.hostname,
    description: og("description") || pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || "",
    image: og("image") ? new URL(og("image"), u.href).href : null,
    siteName: og("site_name") || null,
    icon: new URL(icon, u.href).href,
  };
  cache.set(u.href, { at: Date.now(), data });
  return data;
}
