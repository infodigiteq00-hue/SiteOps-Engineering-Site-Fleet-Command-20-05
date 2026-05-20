import { format } from "date-fns";
import type { SiteReport, SimpleSiteReportRow } from "@/lib/site-report";

const COL_MACHINERY = "Machinery";
const COL_ON_SITE = "On site today";
const COL_IN_DETAIL = "IN — Gate pass & date";
const COL_IN_QTY = "IN — Qty";
const COL_OUT_DETAIL = "OUT — Gate pass & date";
const COL_OUT_QTY = "OUT — Qty";

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

function rowToCells(row: SimpleSiteReportRow): (string | number)[] {
  return [row.machineryName, row.onSiteToday, row.inDetail, row.inQty, row.outDetail, row.outQty];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
        ? `<td class="machinery" rowspan="${group.length}">${escapeHtml(row.machineryName)}</td>
           <td class="center qty-col" rowspan="${group.length}"><strong>${row.onSiteToday}</strong></td>`
        : "";

      parts.push(`<tr class="${groupClass}">
        ${machineryCell}
        <td class="in-detail">${row.inDetail ? escapeHtml(row.inDetail) : "—"}</td>
        <td class="center qty-col">${row.inQty ? escapeHtml(row.inQty) : "—"}</td>
        <td class="out-detail">${row.outDetail ? escapeHtml(row.outDetail) : "—"}</td>
        <td class="center qty-col">${row.outQty ? escapeHtml(row.outQty) : "—"}</td>
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

  push(COL_MACHINERY, COL_ON_SITE, COL_IN_DETAIL, COL_IN_QTY, COL_OUT_DETAIL, COL_OUT_QTY);
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
  .head-sub th { background: #dbeafe; color: #1e3a5f; font-size: 8.5pt; font-weight: bold; text-align: center; padding: 6px 4px; }
  .head-sub .left-sub { text-align: left; }
  tbody td { font-size: 9.5pt; background: #fff; }
  tbody tr.stripe-group td { background: #f8fafc; }
  tbody tr.group-end td { border-bottom: 2px solid #1e3a5f; }
  td.machinery { font-weight: 600; background: #f1f5f9 !important; vertical-align: top; width: 22%; }
  td.in-detail, td.out-detail { width: 26%; }
  td.center, th.center { text-align: center; }
  td.qty-col { width: 9%; font-weight: 600; white-space: nowrap; }
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
        <th class="left-head" rowspan="2">${COL_ON_SITE}</th>
        <th colspan="2">IN (received at site)</th>
        <th colspan="2">OUT (sent from site)</th>
      </tr>
      <tr class="head-sub">
        <th>Gate pass &amp; date</th>
        <th>Qty</th>
        <th>Gate pass &amp; date</th>
        <th>Qty</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || '<tr><td colspan="6" class="empty">No movements recorded for this site.</td></tr>'}
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
