import { useState } from "react";
import { C, BRAND } from "../lib/colors";

export default function Login() {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passphrase: pass }) });
      if (r.ok) { window.location.href = "/"; return; }
      // Show what the server said ("wrong passphrase"), not a guess.
      const d = await r.json().catch(() => ({}));
      const msg = d.error || `Server answered ${r.status}`;
      setErr(msg.charAt(0).toUpperCase() + msg.slice(1));
    } catch {
      setErr("Can't reach the server. Check your connection and try again.");
    }
    setBusy(false);
  };
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: C.bg, color: C.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>
      <form onSubmit={submit} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "32px 36px", width: "min(320px, calc(100vw - 32px))" }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Mission Control</div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 20 }}>Rising Creek Construction</div>
        <input type="password" name="passphrase" autoComplete="current-password" autoFocus aria-label="Passphrase" aria-invalid={!!err} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Passphrase"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${err ? "#f87171" : C.border}`, background: C.bg, color: C.text, fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />
        {err && <div role="alert" style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: BRAND.accent, color: "#0C1017", fontWeight: 600, fontSize: 14, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Opening..." : "Open"}
        </button>
      </form>
    </div>
  );
}
