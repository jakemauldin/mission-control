// Where an RFI item stands: rfi.json "stage". Mirrors stageOf() in server/lib/rfis.js so the page still sorts
// items that predate the field. "status" stays as urgency (blocking = holds up the permit submittal).
export const STAGES = [
  { key: "needs_answer", label: "Needs an answer", blurb: "Still an open question. Someone owes a decision." },
  { key: "our_move", label: "Our move", blurb: "Rising Creek owes the next step." },
  { key: "agreed", label: "Agreed, waiting on drawings", blurb: "Settled, mostly on calls. Waiting for it to show up on the drawings or in a document." },
  { key: "closed", label: "Closed", blurb: "" },
];
export const STAGE_KEYS = STAGES.map(s => s.key);
export const stageLabel = k => STAGES.find(s => s.key === k)?.label || k;

export function stageOf(it) {
  if (it?.status === "closed") return "closed";
  if (STAGE_KEYS.includes(it?.stage)) return it.stage;
  return it?.status === "cleanup" ? "our_move" : "needs_answer";
}

// List rows (/api/rfis) carry `stages` and `blockingOpen`; an older server sends only status counts.
export function rowStages(row) {
  if (row?.stages) return { ...row.stages, blocking: row.blockingOpen ?? row.counts?.blocking ?? 0 };
  const c = row?.counts || {};
  return {
    needs_answer: (c.blocking || 0) + (c.before_submittal || 0),
    our_move: c.cleanup || 0,
    agreed: 0,
    closed: c.closed || 0,
    blocking: c.blocking || 0,
  };
}
