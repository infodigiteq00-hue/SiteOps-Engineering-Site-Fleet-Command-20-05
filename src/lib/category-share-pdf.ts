import { format } from "date-fns";
import { jsPDF } from "jspdf";
import type { Machine, Site } from "@/domain/types";
import { MACHINERY_STATUS_LABELS } from "@/lib/machinery-status-options";

export type CategorySharePdfInput = {
  site: Site;
  category: string;
  machines: Machine[];
  gatePassByMachineId: Map<string, string>;
  dateByMachineId: Map<string, string>;
  unitCount: number;
  categoryPercent: number;
  assignedCount: number;
  fleetCount: number;
  deploymentPercent: number;
  unitLabel?: string;
};

function formatShareDate(iso: string): string {
  const parsed = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10) || "—";
  return format(parsed, "dd-MMM-yyyy");
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "export";
}

function drawWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  for (const line of lines) {
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

/** Build and auto-download a PDF for a category share breakdown. */
export function downloadCategorySharePdf(input: CategorySharePdfInput): void {
  const {
    site,
    category,
    machines,
    gatePassByMachineId,
    dateByMachineId,
    unitCount,
    categoryPercent,
    assignedCount,
    fleetCount,
    deploymentPercent,
    unitLabel = "Machinery",
  } = input;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // —— Site title card (matches site detail hero) ——
  const cardHeight = 48;
  ensureSpace(cardHeight + 8);
  doc.setFillColor(18, 27, 45);
  doc.roundedRect(margin, y, contentWidth, cardHeight, 3, 3, "F");

  const cardPad = 5;
  let textY = y + 8;
  doc.setTextColor(245, 158, 11);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(site.code.toUpperCase(), margin + cardPad, textY);

  textY += 7;
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(site.name, margin + cardPad, textY);

  textY += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  const meta = `${site.location}  ·  ${site.manager}  ·  ${format(new Date(site.startDate), "MMM yyyy")} – ${format(new Date(site.endDate), "MMM yyyy")}`;
  textY = drawWrappedText(doc, meta, margin + cardPad, textY, contentWidth - cardPad * 2 - 28, 4.2);

  // Status badge
  doc.setFillColor(20, 83, 45);
  doc.roundedRect(pageWidth - margin - 22, y + 5, 18, 6, 1.5, 1.5, "F");
  doc.setTextColor(134, 239, 172);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  const statusLabel = site.status.charAt(0).toUpperCase() + site.status.slice(1).replace("-", " ");
  doc.text(statusLabel, pageWidth - margin - 13, y + 9, { align: "center" });

  // Deployment bar
  const barY = y + cardHeight - 12;
  doc.setTextColor(148, 163, 184);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(`Percentage Deployment (${assignedCount} of ${fleetCount} units)`, margin + cardPad, barY);
  doc.setTextColor(255, 255, 255);
  doc.text(`${deploymentPercent}%`, pageWidth - margin - cardPad, barY, { align: "right" });

  const trackY = barY + 2.5;
  const trackW = contentWidth - cardPad * 2;
  doc.setFillColor(51, 65, 85);
  doc.roundedRect(margin + cardPad, trackY, trackW, 2.2, 1, 1, "F");
  const fillW = Math.max(0, Math.min(trackW, (trackW * deploymentPercent) / 100));
  if (fillW > 0) {
    doc.setFillColor(245, 158, 11);
    doc.roundedRect(margin + cardPad, trackY, fillW, 2.2, 1, 1, "F");
  }

  y += cardHeight + 8;

  // —— Category breakdown header ——
  ensureSpace(22);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, 18, 2, 2, "FD");

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(String(unitCount), margin + 4, y + 10);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(unitLabel.toUpperCase(), margin + 4, y + 14.5);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.text(category, margin + 28, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("Assigned units in this category", margin + 28, y + 13);

  doc.setFillColor(226, 232, 240);
  doc.roundedRect(pageWidth - margin - 18, y + 5.5, 14, 7, 2, 2, "F");
  doc.setTextColor(71, 85, 105);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(`${categoryPercent}%`, pageWidth - margin - 11, y + 10.2, { align: "center" });

  y += 22;

  // —— Machinery table ——
  const cols = {
    date: { x: margin, w: 32, label: "DATE" },
    name: { x: margin + 32, w: 78, label: "NAME" },
    gate: { x: margin + 110, w: 36, label: "GATE PASS" },
    status: { x: margin + 146, w: contentWidth - 146, label: "STATUS" },
  };
  const rowH = 8;
  const headerH = 8;

  const drawTableHeader = () => {
    ensureSpace(headerH + rowH);
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, y, contentWidth, headerH, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(cols.date.label, cols.date.x + 2, y + 5.2);
    doc.text(cols.name.label, cols.name.x + 2, y + 5.2);
    doc.text(cols.gate.label, cols.gate.x + 2, y + 5.2);
    doc.text(cols.status.label, cols.status.x + 2, y + 5.2);
    y += headerH;
  };

  drawTableHeader();

  if (machines.length === 0) {
    ensureSpace(rowH);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("No machinery in this category.", margin + 2, y + 5.5);
    y += rowH;
  } else {
    doc.setFont("helvetica", "normal");
    for (const machine of machines) {
      ensureSpace(rowH);
      if (y === margin) drawTableHeader();

      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(255, 255, 255);
      doc.rect(margin, y, contentWidth, rowH, "FD");

      const dateIso = dateByMachineId.get(machine.id);
      const dateLabel = dateIso ? formatShareDate(dateIso) : "—";
      doc.setFontSize(7.5);
      doc.setTextColor(dateLabel === "—" ? 148 : 100, dateLabel === "—" ? 163 : 116, dateLabel === "—" ? 184 : 139);
      doc.setFont("helvetica", "normal");
      doc.text(dateLabel, cols.date.x + 2, y + 5.2, { maxWidth: cols.date.w - 3 });

      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(8);
      const nameLines = doc.splitTextToSize(machine.name, cols.name.w - 3) as string[];
      doc.text(nameLines[0] ?? "", cols.name.x + 2, y + 5.2);

      const gatePass = gatePassByMachineId.get(machine.id) ?? "—";
      doc.setFont("courier", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(gatePass === "—" ? 148 : 15, gatePass === "—" ? 163 : 23, gatePass === "—" ? 184 : 42);
      doc.text(gatePass, cols.gate.x + 2, y + 5.2, { maxWidth: cols.gate.w - 3 });

      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 64, 175);
      doc.setFontSize(8);
      doc.text(MACHINERY_STATUS_LABELS[machine.status] ?? machine.status, cols.status.x + 2, y + 5.2);

      y += rowH;
    }
  }

  const stamp = format(new Date(), "yyyy-MM-dd");
  const filename = `site-${safeFilenamePart(site.code)}-${safeFilenamePart(category)}-${stamp}.pdf`;
  doc.save(filename);
}
