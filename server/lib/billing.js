/**
 * Commercial Billing Module — G702/G703 AIA Payment Applications
 *
 * State management, JobTread data integration, and PDF generation
 * for AIA G702 (Application and Certificate for Payment) and
 * G703 (Continuation Sheet) forms.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfmake = require("pdfmake");

// ── Paths ────────────────────────────────────────────────────
const DATA_DIR = join(import.meta.dirname, "..", "data", "billing");
const SETTINGS_PATH = join(DATA_DIR, "settings.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ── Font setup for pdfmake ──────────────────────────────────
const pdfmakeRoot = join(require.resolve("pdfmake/package.json"), "..");
pdfmake.setFonts({
  Roboto: {
    normal: join(pdfmakeRoot, "fonts", "Roboto", "Roboto-Regular.ttf"),
    bold: join(pdfmakeRoot, "fonts", "Roboto", "Roboto-Medium.ttf"),
    italics: join(pdfmakeRoot, "fonts", "Roboto", "Roboto-Italic.ttf"),
    bolditalics: join(pdfmakeRoot, "fonts", "Roboto", "Roboto-MediumItalic.ttf"),
  },
});

// ── Default settings ─────────────────────────────────────────
const DEFAULT_SETTINGS = {
  contractor: {
    name: "Rising Creek Construction LLC",
    address: "Springtown, TX",
  },
  architect: { name: "", address: "" },
  owner: { name: "", address: "" },
  defaultRetainagePctWork: 10,
  defaultRetainagePctMaterial: 10,
  signatureName: "Jake Mauldin",
  signatureTitle: "President",
};

// ── Settings ─────────────────────────────────────────────────
export function getSettings() {
  if (!existsSync(SETTINGS_PATH)) {
    writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    return DEFAULT_SETTINGS;
  }
  return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
}

export function saveSettings(settings) {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return settings;
}

// ── Job billing state ────────────────────────────────────────
function jobPath(jobId) {
  return join(DATA_DIR, `${jobId}.json`);
}

export function loadJobBilling(jobId) {
  const p = jobPath(jobId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

export function saveJobBilling(jobId, data) {
  writeFileSync(jobPath(jobId), JSON.stringify(data, null, 2));
  return data;
}

// ── Fetch schedule of values from JobTread ───────────────────
export async function fetchScheduleOfValues(jobId, getJobDetailFn) {
  const result = await getJobDetailFn(jobId);
  if (!result.ok) throw new Error(result.error || "Failed to fetch job");

  const job = result.data;
  const lines = [];

  // Cost items are flat on the job, each with a costGroup reference
  const costItems = job.costItems || [];
  // Sort by group, then by name
  const groupOrder = {};
  (job.costGroups?.nodes || []).forEach((g, i) => { groupOrder[g.id] = i; });

  const sorted = [...costItems].sort((a, b) => {
    const ga = groupOrder[a.costGroup?.id] ?? 999;
    const gb = groupOrder[b.costGroup?.id] ?? 999;
    if (ga !== gb) return ga - gb;
    return (a.name || "").localeCompare(b.name || "");
  });

  for (const item of sorted) {
    const groupName = item.costGroup?.name || "(Ungrouped)";
    const groupId = item.costGroup?.id || "ungrouped";
    lines.push({
      id: item.id,
      groupId,
      groupName,
      description: item.name,
      scheduledValue: item.price || 0,
      isChangeOrder: /change\s*order|co\s*#?\d/i.test(groupName) || /change\s*order|co\s*#?\d/i.test(item.name),
    });
  }

  return {
    job: {
      id: job.id,
      name: job.name,
      number: job.number,
      description: job.description,
      createdAt: job.createdAt,
      customer: job.customer,
      location: job.location,
    },
    lines,
  };
}

// ── Application management ───────────────────────────────────

export function createApplication(jobId, { periodTo, jobName, jobNumber }) {
  let billing = loadJobBilling(jobId);
  if (!billing) {
    billing = {
      jobId,
      jobName: jobName || "",
      jobNumber: jobNumber || "",
      applications: [],
    };
  }

  const nextNum = billing.applications.length + 1;
  const app = {
    number: nextNum,
    periodTo: periodTo || new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    status: "draft",
    lineItems: {},
  };

  billing.applications.push(app);
  saveJobBilling(jobId, billing);
  return app;
}

export function updateApplication(jobId, appNum, lineItems) {
  const billing = loadJobBilling(jobId);
  if (!billing) throw new Error("No billing data for this job");

  const app = billing.applications.find((a) => a.number === appNum);
  if (!app) throw new Error(`Application #${appNum} not found`);
  if (app.status === "final") throw new Error("Cannot edit finalized application");

  app.lineItems = lineItems;
  app.updatedAt = new Date().toISOString();
  saveJobBilling(jobId, billing);
  return app;
}

export function updateApplicationMeta(jobId, appNum, meta) {
  const billing = loadJobBilling(jobId);
  if (!billing) throw new Error("No billing data for this job");

  const app = billing.applications.find((a) => a.number === appNum);
  if (!app) throw new Error(`Application #${appNum} not found`);

  if (meta.periodTo) app.periodTo = meta.periodTo;
  if (meta.status && meta.status !== "final") app.status = meta.status;
  app.updatedAt = new Date().toISOString();
  saveJobBilling(jobId, billing);
  return app;
}

export function finalizeApplication(jobId, appNum) {
  const billing = loadJobBilling(jobId);
  if (!billing) throw new Error("No billing data for this job");

  const app = billing.applications.find((a) => a.number === appNum);
  if (!app) throw new Error(`Application #${appNum} not found`);

  app.status = "final";
  app.finalizedAt = new Date().toISOString();
  saveJobBilling(jobId, billing);
  return app;
}

// ── Calculation helpers ──────────────────────────────────────

export function calculateApplication(sovLines, billing, appNum) {
  const settings = getSettings();
  const app = billing?.applications?.find((a) => a.number === appNum);
  if (!app) return null;

  // Get all finalized apps before this one for "previous" totals
  const priorApps = (billing.applications || []).filter(
    (a) => a.number < appNum && a.status === "final"
  );

  const rows = sovLines.map((line, idx) => {
    const scheduledValue = line.scheduledValue || 0;

    // Sum previous applications for this line
    let previousWork = 0;
    let previousMaterials = 0;
    for (const prior of priorApps) {
      const pl = prior.lineItems?.[line.id];
      if (pl) {
        previousWork += pl.workThisPeriod || 0;
        previousMaterials += pl.materialsStored || 0;
      }
    }

    // Current application values
    const current = app.lineItems?.[line.id] || {};
    const workThisPeriod = current.workThisPeriod || 0;
    const materialsStored = current.materialsStored || 0;
    const retainagePct = current.retainagePct;

    // Calculations
    const totalCompletedWork = previousWork + workThisPeriod;
    const totalCompletedAndStored = totalCompletedWork + materialsStored;
    const pctComplete = scheduledValue > 0 ? (totalCompletedAndStored / scheduledValue) * 100 : 0;
    const balanceToFinish = scheduledValue - totalCompletedAndStored;

    // Retainage
    const retWork = retainagePct ?? settings.defaultRetainagePctWork;
    const retMat = retainagePct ?? settings.defaultRetainagePctMaterial;
    const retainageOnWork = totalCompletedWork * (retWork / 100);
    const retainageOnMaterial = materialsStored * (retMat / 100);
    const totalRetainage = retainageOnWork + retainageOnMaterial;

    return {
      itemNo: idx + 1,
      id: line.id,
      groupName: line.groupName,
      description: line.description,
      isChangeOrder: line.isChangeOrder,
      scheduledValue,
      previousWork,
      previousMaterials,
      workThisPeriod,
      materialsStored,
      totalCompletedWork,
      totalCompletedAndStored,
      pctComplete: Math.min(pctComplete, 100),
      balanceToFinish: Math.max(balanceToFinish, 0),
      retainagePctWork: retWork,
      retainagePctMaterial: retMat,
      retainageOnWork,
      retainageOnMaterial,
      totalRetainage,
    };
  });

  // G702 summary
  const contractLines = rows.filter((r) => !r.isChangeOrder);
  const coLines = rows.filter((r) => r.isChangeOrder);

  const originalContractSum = contractLines.reduce((s, r) => s + r.scheduledValue, 0);
  const netChangeOrders = coLines.reduce((s, r) => s + r.scheduledValue, 0);
  const contractSumToDate = originalContractSum + netChangeOrders;
  const totalCompleted = rows.reduce((s, r) => s + r.totalCompletedAndStored, 0);
  const totalRetainage = rows.reduce((s, r) => s + r.totalRetainage, 0);
  const totalEarnedLessRetainage = totalCompleted - totalRetainage;

  // Previous certificates = total earned less retainage from prior apps
  let prevCertificates = 0;
  for (const prior of priorApps) {
    // Recalculate prior app's total earned less retainage
    let priorTotal = 0;
    let priorRet = 0;
    for (const line of sovLines) {
      let cumWork = 0;
      let cumMat = 0;
      for (const pa of billing.applications.filter(
        (a) => a.number <= prior.number && a.status === "final"
      )) {
        const pl = pa.lineItems?.[line.id];
        if (pl) {
          cumWork += pl.workThisPeriod || 0;
          cumMat += pl.materialsStored || 0;
        }
      }
      priorTotal += cumWork + cumMat;
      const retPct = prior.lineItems?.[line.id]?.retainagePct ?? settings.defaultRetainagePctWork;
      priorRet += cumWork * (retPct / 100) + cumMat * ((prior.lineItems?.[line.id]?.retainagePct ?? settings.defaultRetainagePctMaterial) / 100);
    }
    prevCertificates = priorTotal - priorRet;
  }

  const currentPaymentDue = totalEarnedLessRetainage - prevCertificates;
  const balanceToFinish = contractSumToDate - totalCompleted;

  return {
    rows,
    summary: {
      originalContractSum,
      netChangeOrders,
      contractSumToDate,
      totalCompleted,
      totalRetainage,
      totalEarnedLessRetainage,
      prevCertificates,
      currentPaymentDue,
      balanceToFinish,
    },
  };
}

// ── PDF Generation ───────────────────────────────────────────

function fmt(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n) {
  return `${Math.round(n * 10) / 10}%`;
}

function headerCell(text) {
  return { text, bold: true, fontSize: 7, alignment: "center", fillColor: "#1a1a2e", color: "#ffffff", margin: [2, 4, 2, 4] };
}

function numCell(val, opts = {}) {
  return { text: fmt(val), fontSize: 7.5, alignment: "right", margin: [2, 3, 4, 3], ...opts };
}

function pctCell(val) {
  return { text: fmtPct(val), fontSize: 7.5, alignment: "center", margin: [2, 3, 2, 3] };
}

function textCell(val, opts = {}) {
  return { text: val, fontSize: 7.5, margin: [4, 3, 2, 3], ...opts };
}

export function generateG702Pdf(calcResult, jobInfo, appMeta) {
  const settings = getSettings();
  const s = calcResult.summary;

  const docDef = {
    pageSize: "LETTER",
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: "Roboto", fontSize: 9 },
    content: [
      // Title
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "AIA DOCUMENT G702", fontSize: 14, bold: true, color: "#1a1a2e" },
              { text: "APPLICATION AND CERTIFICATE FOR PAYMENT", fontSize: 9, bold: true, color: "#555", margin: [0, 2, 0, 10] },
            ],
          },
          {
            width: "auto",
            stack: [
              { text: `APPLICATION NO: ${appMeta.number}`, fontSize: 9, bold: true, alignment: "right" },
              { text: `APPLICATION DATE: ${new Date().toLocaleDateString("en-US")}`, fontSize: 8, alignment: "right" },
              { text: `PERIOD TO: ${appMeta.periodTo}`, fontSize: 8, alignment: "right" },
            ],
          },
        ],
      },

      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 1, lineColor: "#1a1a2e" }], margin: [0, 5, 0, 10] },

      // Project info
      {
        columns: [
          {
            width: "50%",
            stack: [
              { text: "TO OWNER:", fontSize: 7, bold: true, color: "#888" },
              { text: jobInfo.customer?.name || settings.owner.name || "—", fontSize: 9, bold: true },
              { text: settings.owner.address || "", fontSize: 8, color: "#555" },
              { text: "", margin: [0, 6, 0, 0] },
              { text: "FROM CONTRACTOR:", fontSize: 7, bold: true, color: "#888" },
              { text: settings.contractor.name, fontSize: 9, bold: true },
              { text: settings.contractor.address, fontSize: 8, color: "#555" },
            ],
          },
          {
            width: "50%",
            stack: [
              { text: "PROJECT:", fontSize: 7, bold: true, color: "#888" },
              { text: jobInfo.name || "—", fontSize: 9, bold: true },
              { text: jobInfo.location?.name || jobInfo.location?.address || "", fontSize: 8, color: "#555" },
              { text: "", margin: [0, 6, 0, 0] },
              { text: "ARCHITECT:", fontSize: 7, bold: true, color: "#888" },
              { text: settings.architect.name || "N/A", fontSize: 9 },
              { text: settings.architect.address || "", fontSize: 8, color: "#555" },
              { text: "", margin: [0, 4, 0, 0] },
              { text: `CONTRACT FOR: General Construction`, fontSize: 8 },
              { text: `PROJECT NO: ${jobInfo.number || "—"}`, fontSize: 8 },
              { text: `CONTRACT DATE: ${jobInfo.createdAt ? new Date(jobInfo.createdAt).toLocaleDateString("en-US") : "—"}`, fontSize: 8 },
            ],
          },
        ],
        margin: [0, 0, 0, 15],
      },

      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 0.5, lineColor: "#ccc" }], margin: [0, 0, 0, 10] },

      // Contractor's Application
      { text: "CONTRACTOR'S APPLICATION FOR PAYMENT", fontSize: 10, bold: true, color: "#1a1a2e", margin: [0, 0, 0, 8] },
      { text: "Application is made for payment, as shown below, in connection with the Contract.\nContinuation Sheet, AIA Document G703, is attached.", fontSize: 8, color: "#555", margin: [0, 0, 0, 10] },

      // The 9-line summary table
      {
        table: {
          widths: [30, "*", 120],
          body: [
            [
              { text: "1.", fontSize: 9, bold: true, margin: [4, 5, 0, 5] },
              { text: "ORIGINAL CONTRACT SUM", fontSize: 9, margin: [0, 5, 0, 5] },
              { text: fmt(s.originalContractSum), fontSize: 9, bold: true, alignment: "right", margin: [0, 5, 8, 5] },
            ],
            [
              { text: "2.", fontSize: 9, bold: true, margin: [4, 5, 0, 5] },
              { text: "Net Change by Change Orders", fontSize: 9, margin: [0, 5, 0, 5] },
              { text: fmt(s.netChangeOrders), fontSize: 9, bold: true, alignment: "right", margin: [0, 5, 8, 5] },
            ],
            [
              { text: "3.", fontSize: 9, bold: true, margin: [4, 5, 0, 5], fillColor: "#f0f4f8" },
              { text: "CONTRACT SUM TO DATE (Line 1 + 2)", fontSize: 9, bold: true, margin: [0, 5, 0, 5], fillColor: "#f0f4f8" },
              { text: fmt(s.contractSumToDate), fontSize: 9, bold: true, alignment: "right", margin: [0, 5, 8, 5], fillColor: "#f0f4f8" },
            ],
            [
              { text: "4.", fontSize: 9, bold: true, margin: [4, 5, 0, 5] },
              { text: "TOTAL COMPLETED & STORED TO DATE (Column G on G703)", fontSize: 9, margin: [0, 5, 0, 5] },
              { text: fmt(s.totalCompleted), fontSize: 9, bold: true, alignment: "right", margin: [0, 5, 8, 5] },
            ],
            [
              { text: "5.", fontSize: 9, bold: true, margin: [4, 5, 0, 5] },
              {
                stack: [
                  { text: "RETAINAGE:", fontSize: 9 },
                  { text: `    a. ${settings.defaultRetainagePctWork}% of Completed Work`, fontSize: 8, color: "#555" },
                  { text: `    b. ${settings.defaultRetainagePctMaterial}% of Stored Material`, fontSize: 8, color: "#555" },
                ],
                margin: [0, 5, 0, 5],
              },
              { text: fmt(s.totalRetainage), fontSize: 9, bold: true, alignment: "right", margin: [0, 5, 8, 5] },
            ],
            [
              { text: "6.", fontSize: 9, bold: true, margin: [4, 5, 0, 5], fillColor: "#f0f4f8" },
              { text: "TOTAL EARNED LESS RETAINAGE (Line 4 - 5)", fontSize: 9, bold: true, margin: [0, 5, 0, 5], fillColor: "#f0f4f8" },
              { text: fmt(s.totalEarnedLessRetainage), fontSize: 9, bold: true, alignment: "right", margin: [0, 5, 8, 5], fillColor: "#f0f4f8" },
            ],
            [
              { text: "7.", fontSize: 9, bold: true, margin: [4, 5, 0, 5] },
              { text: "LESS PREVIOUS CERTIFICATES FOR PAYMENT", fontSize: 9, margin: [0, 5, 0, 5] },
              { text: fmt(s.prevCertificates), fontSize: 9, bold: true, alignment: "right", margin: [0, 5, 8, 5] },
            ],
            [
              { text: "8.", fontSize: 9, bold: true, margin: [4, 6, 0, 6], fillColor: "#e8f5e9" },
              { text: "CURRENT PAYMENT DUE (Line 6 - 7)", fontSize: 10, bold: true, margin: [0, 6, 0, 6], fillColor: "#e8f5e9" },
              { text: fmt(s.currentPaymentDue), fontSize: 10, bold: true, alignment: "right", margin: [0, 6, 8, 6], fillColor: "#e8f5e9" },
            ],
            [
              { text: "9.", fontSize: 9, bold: true, margin: [4, 5, 0, 5] },
              { text: "BALANCE TO FINISH, INCLUDING RETAINAGE (Line 3 - 4)", fontSize: 9, margin: [0, 5, 0, 5] },
              { text: fmt(s.balanceToFinish), fontSize: 9, bold: true, alignment: "right", margin: [0, 5, 8, 5] },
            ],
          ],
        },
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
          vLineWidth: () => 0.5,
          hLineColor: (i, node) => (i === 0 || i === node.table.body.length ? "#1a1a2e" : "#ddd"),
          vLineColor: () => "#ddd",
        },
        margin: [0, 0, 0, 20],
      },

      // Signature block
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 0.5, lineColor: "#ccc" }], margin: [0, 10, 0, 15] },

      {
        columns: [
          {
            width: "50%",
            stack: [
              { text: settings.contractor.name, fontSize: 9, bold: true },
              { text: "", margin: [0, 20, 0, 0] },
              { canvas: [{ type: "line", x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5 }] },
              { text: `By: ${settings.signatureName}`, fontSize: 8, margin: [0, 4, 0, 0] },
              { text: `Title: ${settings.signatureTitle}`, fontSize: 8 },
              { text: `Date: ${new Date().toLocaleDateString("en-US")}`, fontSize: 8 },
            ],
          },
          {
            width: "50%",
            stack: [
              { text: "State of: Texas", fontSize: 8 },
              { text: "County of: _______________", fontSize: 8 },
              { text: "", margin: [0, 8, 0, 0] },
              { text: `Subscribed and sworn to before me this`, fontSize: 7, color: "#888" },
              { text: `_____ day of _______________, ${new Date().getFullYear()}`, fontSize: 7, color: "#888" },
              { text: "", margin: [0, 12, 0, 0] },
              { canvas: [{ type: "line", x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5 }] },
              { text: "Notary Public", fontSize: 8, margin: [0, 4, 0, 0] },
            ],
          },
        ],
      },
    ],
  };

  return docDef;
}

export function generateG703Pdf(calcResult, jobInfo, appMeta) {
  const rows = calcResult.rows;

  // Build table body
  const tableBody = [
    // Header row
    [
      headerCell("ITEM\nNO."),
      headerCell("DESCRIPTION OF WORK"),
      headerCell("SCHEDULED\nVALUE"),
      headerCell("WORK COMPLETED\nFROM PREVIOUS\nAPPLICATION"),
      headerCell("WORK COMPLETED\nTHIS PERIOD"),
      headerCell("MATERIALS\nPRESENTLY\nSTORED"),
      headerCell("TOTAL\nCOMPLETED &\nSTORED TO DATE"),
      headerCell("%\n(G/C)"),
      headerCell("BALANCE\nTO FINISH\n(C - G)"),
      headerCell("RETAINAGE"),
    ],
    // Column letter header
    [
      headerCell("A"),
      headerCell("B"),
      headerCell("C"),
      headerCell("D"),
      headerCell("E"),
      headerCell("F"),
      headerCell("G"),
      headerCell("H"),
      headerCell("I"),
      headerCell("J"),
    ],
  ];

  // Group rows by cost group
  let lastGroup = "";
  for (const r of rows) {
    // Add group header if new group
    if (r.groupName && r.groupName !== lastGroup) {
      lastGroup = r.groupName;
      tableBody.push([
        { text: "", fillColor: "#f5f5f5" },
        { text: r.groupName, fontSize: 7, bold: true, colSpan: 9, fillColor: "#f5f5f5", margin: [4, 3, 2, 3], color: "#333" },
        {}, {}, {}, {}, {}, {}, {}, {},
      ]);
    }

    const isActive = r.workThisPeriod > 0 || r.materialsStored > 0;
    const rowFill = isActive ? "#fafffe" : undefined;

    tableBody.push([
      { text: String(r.itemNo), fontSize: 7, alignment: "center", margin: [2, 3, 2, 3], fillColor: rowFill },
      { text: r.description, fontSize: 7, margin: [4, 3, 2, 3], fillColor: rowFill },
      numCell(r.scheduledValue, { fillColor: rowFill }),
      numCell(r.previousWork + r.previousMaterials, { fillColor: rowFill }),
      numCell(r.workThisPeriod, { fillColor: rowFill, bold: isActive, color: isActive ? "#1a6b3c" : undefined }),
      numCell(r.materialsStored, { fillColor: rowFill }),
      numCell(r.totalCompletedAndStored, { fillColor: rowFill, bold: true }),
      pctCell(r.pctComplete),
      numCell(r.balanceToFinish, { fillColor: rowFill }),
      numCell(r.totalRetainage, { fillColor: rowFill }),
    ]);
  }

  // Totals row
  const totals = calcResult.summary;
  tableBody.push([
    { text: "", fillColor: "#1a1a2e" },
    { text: "TOTALS", fontSize: 8, bold: true, fillColor: "#1a1a2e", color: "#ffffff", margin: [4, 4, 2, 4] },
    numCell(totals.contractSumToDate, { fillColor: "#1a1a2e", color: "#ffffff", bold: true }),
    numCell(totals.totalCompleted - rows.reduce((s, r) => s + r.workThisPeriod + r.materialsStored, 0), { fillColor: "#1a1a2e", color: "#ffffff", bold: true }),
    numCell(rows.reduce((s, r) => s + r.workThisPeriod, 0), { fillColor: "#1a1a2e", color: "#ffffff", bold: true }),
    numCell(rows.reduce((s, r) => s + r.materialsStored, 0), { fillColor: "#1a1a2e", color: "#ffffff", bold: true }),
    numCell(totals.totalCompleted, { fillColor: "#1a1a2e", color: "#ffffff", bold: true }),
    { text: totals.contractSumToDate > 0 ? fmtPct((totals.totalCompleted / totals.contractSumToDate) * 100) : "0%", fontSize: 8, bold: true, alignment: "center", fillColor: "#1a1a2e", color: "#ffffff", margin: [2, 4, 2, 4] },
    numCell(totals.balanceToFinish, { fillColor: "#1a1a2e", color: "#ffffff", bold: true }),
    numCell(totals.totalRetainage, { fillColor: "#1a1a2e", color: "#ffffff", bold: true }),
  ]);

  const docDef = {
    pageSize: "LETTER",
    pageOrientation: "landscape",
    pageMargins: [20, 40, 20, 30],
    defaultStyle: { font: "Roboto", fontSize: 8 },
    header: {
      columns: [
        { text: "AIA DOCUMENT G703 — CONTINUATION SHEET", fontSize: 9, bold: true, color: "#1a1a2e", margin: [20, 15, 0, 0] },
        { text: `Application No: ${appMeta.number}  |  ${jobInfo.name || ""}  |  Period To: ${appMeta.periodTo}`, fontSize: 7, alignment: "right", color: "#888", margin: [0, 17, 20, 0] },
      ],
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `${jobInfo.name} — Application #${appMeta.number}`, fontSize: 7, color: "#aaa", margin: [20, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7, color: "#aaa", alignment: "right", margin: [0, 0, 20, 0] },
      ],
    }),
    content: [
      {
        table: {
          headerRows: 2,
          widths: [25, "*", 65, 65, 65, 55, 65, 30, 65, 55],
          body: tableBody,
        },
        layout: {
          hLineWidth: (i) => (i <= 2 ? 1 : 0.3),
          vLineWidth: () => 0.3,
          hLineColor: (i) => (i <= 2 ? "#1a1a2e" : "#ddd"),
          vLineColor: () => "#e0e0e0",
          paddingLeft: () => 2,
          paddingRight: () => 2,
        },
      },
    ],
  };

  return docDef;
}

export function generateCombinedPdf(calcResult, jobInfo, appMeta) {
  const g702 = generateG702Pdf(calcResult, jobInfo, appMeta);
  const g703 = generateG703Pdf(calcResult, jobInfo, appMeta);

  // Combine: G702 first page (portrait), then G703 (landscape)
  // pdfmake doesn't support mixed orientations in one doc easily,
  // so we'll generate them separately and return both
  return { g702, g703 };
}

// ── Create PDF buffer from doc definition ────────────────────

export async function createPdfBuffer(docDefinition) {
  const doc = pdfmake.createPdf(docDefinition);
  const stream = await doc.getStream();
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    stream.end();
  });
}
