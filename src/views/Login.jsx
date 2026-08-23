import { useState } from "react";
import { C, BRAND } from "../lib/colors";

export default function Login() {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passphrase: pass }) });
    if (r.ok) window.location.href = "/";
    else setErr("Wrong passphrase");
  };
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: C.bg, color: C.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>
      <form onSubmit={submit} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "32px 36px", width: 320 }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Mission Control</div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 20 }}>Rising Creek Construction</div>
        <input type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Passphrase"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${err ? "#f87171" : C.border}`, background: C.bg, color: C.text, fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />
        {err && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <button type="submit" style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: BRAND.accent, color: "#0C1017", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
          Open
        </button>
      </form>
    </div>
  );
}
