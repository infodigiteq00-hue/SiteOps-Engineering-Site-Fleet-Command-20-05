import { format } from "date-fns";
import type { SiteReport, SimpleSiteReportRow } from "@/lib/site-report";

const COL_MACHINERY = "Machinery";
const COL_ON_SITE = "On Site Today";
const COL_IN_GROUP = "IN — (From Site to Store)";
const COL_OUT_GROUP = "OUT — (From Store to Site)";
const COL_QTY = "Qty";
const COL_DATE = "Date";
const COL_GATE_PASS = "Gate pass no.";

/** Hard-hat SiteManager icon — embedded so the report preview tab does not inherit a host default favicon. */
const SITE_MANAGER_FAVICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="SiteManager"><defs><linearGradient id="sm-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#2f3f54"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#sm-bg)"/><g transform="translate(4 4)" fill="none" stroke="#ffffff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M14 6a6 6 0 0 1 6 6v3"/><path d="M4 15v-3a6 6 0 0 1 6-6"/><rect x="2" y="15" width="20" height="4" rx="1"/></g></svg>',
)}`;

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Display order under each IN/OUT group: gate pass, date, qty. */
export function simpleReportRowCells(row: SimpleSiteReportRow): string[] {
  return [
    row.machineryName,
    row.outGatePass,
    row.outDate,
    row.outQty,
    row.inGatePass,
    row.inDate,
    row.inQty,
    row.onSiteToday,
  ];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellOrDash(value: string): string {
  return value ? escapeHtml(value) : "—";
}

function groupRowsByMachinery(rows: SimpleSiteReportRow[]): SimpleSiteReportRow[][] {
  const groups: SimpleSiteReportRow[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last[0].machineryName === row.machineryName) {
      last.push(row);
    } else {
      groups.push([row]);
    }
  }
  return groups;
}

function buildPdfBodyRows(rows: SimpleSiteReportRow[]): string {
  const groups = groupRowsByMachinery(rows);
  const parts: string[] = [];

  groups.forEach((group, groupIndex) => {
    group.forEach((row, rowIndex) => {
      const isFirst = rowIndex === 0;
      const isLastInGroup = rowIndex === group.length - 1;
      const groupClass = [
        groupIndex % 2 === 1 ? "stripe-group" : "",
        isLastInGroup && groupIndex < groups.length - 1 ? "group-end" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const machineryCell = isFirst
        ? `<td class="machinery" rowspan="${group.length}">${escapeHtml(row.machineryName)}</td>`
        : "";
      const onSiteCell = isFirst
        ? `<td class="center on-site-col" rowspan="${group.length}">${cellOrDash(row.onSiteToday)}</td>`
        : "";

      parts.push(`<tr class="${groupClass}">
        ${machineryCell}
        <td class="gate-col out-data">${cellOrDash(row.outGatePass)}</td>
        <td class="center date-col out-data">${cellOrDash(row.outDate)}</td>
        <td class="center qty-col out-data">${cellOrDash(row.outQty)}</td>
        <td class="gate-col in-data">${cellOrDash(row.inGatePass)}</td>
        <td class="center date-col in-data">${cellOrDash(row.inDate)}</td>
        <td class="center qty-col in-data">${cellOrDash(row.inQty)}</td>
        ${onSiteCell}
      </tr>`);
    });
  });

  return parts.join("");
}

export function downloadSiteReportExcel(report: SiteReport) {
  const lines: string[] = [];
  const push = (...cells: (string | number)[]) => lines.push(cells.map(csvCell).join(","));

  push("Site machinery movement report");
  push("Site name", report.siteName);
  push("Site code", report.siteCode);
  push("Location", report.location);
  push("Report date", report.generatedAtLabel);
  lines.push("");

  push(
    COL_MACHINERY,
    `${COL_OUT_GROUP} — ${COL_GATE_PASS}`,
    `${COL_OUT_GROUP} — ${COL_DATE}`,
    `${COL_OUT_GROUP} — ${COL_QTY}`,
    `${COL_IN_GROUP} — ${COL_GATE_PASS}`,
    `${COL_IN_GROUP} — ${COL_DATE}`,
    `${COL_IN_GROUP} — ${COL_QTY}`,
    COL_ON_SITE,
  );
  for (const row of report.rows) {
    push(...simpleReportRowCells(row));
  }

  if (report.rows.length === 0) {
    push("No machinery movements recorded for this site yet.");
  }

  if (report.closureSummary) {
    lines.push("");
    push("Note: site marked finished");
    push("Units returned to pool", report.closureSummary.available);
    push("Units lost or damaged", report.closureSummary.lost_damaged);
  }

  const stamp = format(new Date(report.generatedAt), "yyyy-MM-dd");
  const safeName = report.siteCode.replace(/[^a-zA-Z0-9-_]/g, "_");
  downloadBlob(lines.join("\n"), `site-report-${safeName}-${stamp}.csv`, "text/csv;charset=utf-8;");
}

export function openSiteReportPdf(report: SiteReport) {
  const bodyRows = buildPdfBodyRows(report.rows);

  const closureNote = report.closureSummary
    ? `<p class="note">Site marked finished — ${report.closureSummary.available} returned to pool · ${report.closureSummary.lost_damaged} lost/damaged</p>`
    : "";

  const stamp = format(new Date(report.generatedAt), "yyyy-MM-dd");
  const safeName = report.siteCode.replace(/[^a-zA-Z0-9-_]/g, "_");
  const pdfFilename = `site-report-${safeName}-${stamp}.pdf`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<link rel="icon" href="${SITE_MANAGER_FAVICON_DATA_URL}" type="image/svg+xml" />
<link rel="apple-touch-icon" href="${SITE_MANAGER_FAVICON_DATA_URL}" />
<title>${escapeHtml(report.siteName)} — Machinery report</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body, table, thead, tbody, tr, th, td {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #1a1a1a; margin: 14mm 12mm; }
  .report-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
  .report-header-text { min-width: 0; flex: 1; }
  h1 { font-size: 13pt; font-weight: bold; margin: 0 0 4px; color: #1e3a5f; }
  .meta { font-size: 9pt; margin: 0; line-height: 1.55; color: #444; }
  .download-pdf-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    font-size: 9.5pt;
    font-weight: 600;
    font-family: inherit;
    color: #fff;
    background: #1e3a5f;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0,0,0,0.12);
  }
  .download-pdf-btn:hover { background: #1e40af; }
  .download-pdf-btn:active { transform: translateY(1px); }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #94a3b8; padding: 7px 8px; text-align: left; vertical-align: middle; word-wrap: break-word; }
  .head-top th { background: #1e3a5f; color: #fff; font-size: 9pt; font-weight: bold; text-align: center; padding: 8px 6px; }
  .head-top .left-head { text-align: left; background: #1e3a5f; }
  .head-top .head-in-group { background: #d97706; color: #fff; }
  .head-top .head-out-group { background: #059669; color: #fff; }
  .head-sub th { font-size: 8.5pt; font-weight: bold; text-align: center; padding: 6px 4px; }
  .head-sub .head-in-sub { background: #ffedd5; color: #9a3412; }
  .head-sub .head-out-sub { background: #d1fae5; color: #065f46; }
  tbody td { font-size: 9.5pt; background: #fff; }
  tbody tr.stripe-group td { background: #f8fafc; }
  tbody tr.group-end td { border-bottom: 2px solid #1e3a5f; }
  td.machinery { font-weight: 600; background: #f1f5f9 !important; vertical-align: top; width: 22%; }
  .head-top .head-on-site { background: #1e40af; color: #fff; text-align: center; width: 12%; }
  td.on-site-col { background: #eff6ff !important; text-align: center; color: #1e3a5f; font-weight: 600; width: 12%; white-space: nowrap; }
  td.center, th.center { text-align: center; }
  td.qty-col { width: 8%; font-weight: 600; white-space: nowrap; }
  td.date-col { width: 11%; white-space: nowrap; }
  td.gate-col { width: 10%; }
  td.out-data { color: #047857; font-weight: 600; }
  td.in-data { color: #c2410c; font-weight: 600; }
  .note { font-size: 8.5pt; margin-top: 10px; color: #64748b; }
  .empty { padding: 20px; text-align: center; font-style: italic; color: #64748b; }
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin: 10mm; }
    tbody tr { page-break-inside: avoid; }
    .no-print { display: none !important; }
    .head-top th { background-color: #1e3a5f !important; color: #fff !important; }
    .head-top .left-head { background-color: #1e3a5f !important; color: #fff !important; }
    .head-top .head-out-group { background-color: #059669 !important; color: #fff !important; }
    .head-top .head-in-group { background-color: #d97706 !important; color: #fff !important; }
    .head-top .head-on-site { background-color: #1e40af !important; color: #fff !important; }
    .head-sub .head-out-sub { background-color: #d1fae5 !important; color: #065f46 !important; }
    .head-sub .head-in-sub { background-color: #ffedd5 !important; color: #9a3412 !important; }
    td.machinery { background-color: #f1f5f9 !important; }
    td.on-site-col { background-color: #eff6ff !important; color: #1e3a5f !important; }
    tbody tr.stripe-group td { background-color: #f8fafc !important; }
    td.out-data { color: #047857 !important; }
    td.in-data { color: #c2410c !important; }
  }
</style></head><body>
  <div class="report-header">
    <div class="report-header-text">
      <h1>Site machinery movement report</h1>
      <p class="meta">
        <strong>${escapeHtml(report.siteName)}</strong> (${escapeHtml(report.siteCode)}) · ${escapeHtml(report.location)}<br/>
        Report date: ${escapeHtml(report.generatedAtLabel)}
      </p>
    </div>
    <button type="button" class="download-pdf-btn no-print" onclick="downloadPdf()" title="Save as PDF">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Download PDF
    </button>
  </div>
  <table>
    <thead>
      <tr class="head-top">
        <th class="left-head" rowspan="2">${COL_MACHINERY}</th>
        <th colspan="3" class="head-out-group">${COL_OUT_GROUP}</th>
        <th colspan="3" class="head-in-group">${COL_IN_GROUP}</th>
        <th class="head-on-site" rowspan="2">${COL_ON_SITE}</th>
      </tr>
      <tr class="head-sub">
        <th class="head-out-sub">${COL_GATE_PASS}</th>
        <th class="head-out-sub">${COL_DATE}</th>
        <th class="head-out-sub">${COL_QTY}</th>
        <th class="head-in-sub">${COL_GATE_PASS}</th>
        <th class="head-in-sub">${COL_DATE}</th>
        <th class="head-in-sub">${COL_QTY}</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || '<tr><td colspan="8" class="empty">No movements recorded for this site.</td></tr>'}
    </tbody>
  </table>
  ${closureNote}
  <script>
    var suggestedPdfName = ${JSON.stringify(pdfFilename)};
    function downloadPdf() {
      var prev = document.title;
      document.title = suggestedPdfName.replace(/\\.pdf$/i, "");
      window.print();
      setTimeout(function() { document.title = prev; }, 500);
    }
  </script>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
