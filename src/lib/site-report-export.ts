import { format } from "date-fns";
import type { SiteReport, SimpleSiteReportRow } from "@/lib/site-report";

const COL_MACHINERY = "Machinery";
const COL_ON_SITE = "On Site Today";
const COL_IN_GROUP = "IN — (From Site to Store)";
const COL_OUT_GROUP = "OUT — (From Store to Site)";
const COL_QTY = "Qty";
const COL_DATE = "Date";
const COL_GATE_PASS = "Gate pass no.";

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

function rowToCells(row: SimpleSiteReportRow): string[] {
  return [
    row.machineryName,
    row.outQty,
    row.outDate,
    row.outGatePass,
    row.inQty,
    row.inDate,
    row.inGatePass,
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
        <td class="center qty-col">${cellOrDash(row.outQty)}</td>
        <td class="center date-col">${cellOrDash(row.outDate)}</td>
        <td class="gate-col">${cellOrDash(row.outGatePass)}</td>
        <td class="center qty-col">${cellOrDash(row.inQty)}</td>
        <td class="center date-col">${cellOrDash(row.inDate)}</td>
        <td class="gate-col">${cellOrDash(row.inGatePass)}</td>
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
    `${COL_OUT_GROUP} — ${COL_QTY}`,
    `${COL_OUT_GROUP} — ${COL_DATE}`,
    `${COL_OUT_GROUP} — ${COL_GATE_PASS}`,
    `${COL_IN_GROUP} — ${COL_QTY}`,
    `${COL_IN_GROUP} — ${COL_DATE}`,
    `${COL_IN_GROUP} — ${COL_GATE_PASS}`,
    COL_ON_SITE,
  );
  for (const row of report.rows) {
    push(...rowToCells(row));
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

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(report.siteName)} — Machinery report</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #1a1a1a; margin: 14mm 12mm; }
  h1 { font-size: 13pt; font-weight: bold; margin: 0 0 4px; color: #1e3a5f; }
  .meta { font-size: 9pt; margin-bottom: 14px; line-height: 1.55; color: #444; }
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
  .note { font-size: 8.5pt; margin-top: 10px; color: #64748b; }
  .empty { padding: 20px; text-align: center; font-style: italic; color: #64748b; }
  @media print {
    body { margin: 10mm; }
    tbody tr { page-break-inside: avoid; }
  }
</style></head><body>
  <h1>Site machinery movement report</h1>
  <p class="meta">
    <strong>${escapeHtml(report.siteName)}</strong> (${escapeHtml(report.siteCode)}) · ${escapeHtml(report.location)}<br/>
    Report date: ${escapeHtml(report.generatedAtLabel)}
  </p>
  <table>
    <thead>
      <tr class="head-top">
        <th class="left-head" rowspan="2">${COL_MACHINERY}</th>
        <th colspan="3" class="head-out-group">${COL_OUT_GROUP}</th>
        <th colspan="3" class="head-in-group">${COL_IN_GROUP}</th>
        <th class="head-on-site" rowspan="2">${COL_ON_SITE}</th>
      </tr>
      <tr class="head-sub">
        <th class="head-out-sub">${COL_QTY}</th>
        <th class="head-out-sub">${COL_DATE}</th>
        <th class="head-out-sub">${COL_GATE_PASS}</th>
        <th class="head-in-sub">${COL_QTY}</th>
        <th class="head-in-sub">${COL_DATE}</th>
        <th class="head-in-sub">${COL_GATE_PASS}</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || '<tr><td colspan="8" class="empty">No movements recorded for this site.</td></tr>'}
    </tbody>
  </table>
  ${closureNote}
  <script>window.onload = function() { window.print(); }</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
