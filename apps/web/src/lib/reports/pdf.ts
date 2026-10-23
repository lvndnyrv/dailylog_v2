import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ReportPreview } from "./data";

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 42;
const TABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const navy = rgb(0.09, 0.2, 0.36);
const muted = rgb(0.36, 0.43, 0.53);
const blue = rgb(0.18, 0.49, 0.85);
const pale = rgb(0.96, 0.98, 1);
const border = rgb(0.84, 0.89, 0.95);

export class UnsupportedReportGlyphError extends Error {}

function printable(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
}

function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  const words = printable(value).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const char of word) {
      if (font.widthOfTextAtSize(line + char, size) > width && line) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawPageHeader(page: PDFPage, title: string, center: string, period: string, continued: boolean, bold: PDFFont, regular: PDFFont) {
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 7, width: PAGE_WIDTH, height: 7, color: blue });
  page.drawText("DAILYLOG  /  CENTER REPORT", { x: MARGIN, y: PAGE_HEIGHT - 39, size: 9, font: bold, color: blue });
  page.drawText(continued ? `${title} - continued` : title, { x: MARGIN, y: PAGE_HEIGHT - 70, size: 20, font: bold, color: navy });
  page.drawText(center, { x: MARGIN, y: PAGE_HEIGHT - 91, size: 9, font: regular, color: muted });
  page.drawText(period, { x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(period, 9), y: PAGE_HEIGHT - 91, size: 9, font: regular, color: muted });
}

function drawTableHeader(page: PDFPage, columns: string[], y: number, bold: PDFFont) {
  const width = TABLE_WIDTH / columns.length;
  page.drawRectangle({ x: MARGIN, y: y - 28, width: TABLE_WIDTH, height: 28, color: pale, borderColor: border, borderWidth: 0.6 });
  columns.forEach((column, index) => {
    page.drawText(printable(column), { x: MARGIN + index * width + 9, y: y - 18, size: 8.5, font: bold, color: navy });
  });
  return y - 28;
}

export async function renderReportPdf(preview: ReportPreview, centerName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(join(process.cwd(), "public/fonts/report-noto-sans-regular.ttf")),
    readFile(join(process.cwd(), "public/fonts/report-noto-sans-bold.ttf")),
  ]);
  const fontFace = fontkit.create(regularBytes);
  const visibleText = [preview.title, centerName, preview.emptyHint,
    ...preview.columns, ...preview.metrics.flatMap((metric) => [metric.label, metric.value]),
    ...preview.rows.flat()];
  for (const value of visibleText) {
    for (const char of printable(value)) {
      if (!fontFace.hasGlyphForCodePoint(char.codePointAt(0)!)) {
        throw new UnsupportedReportGlyphError("This PDF font cannot display every character in the report. Download CSV instead.");
      }
    }
  }
  const regular = await doc.embedFont(regularBytes);
  const bold = await doc.embedFont(boldBytes);
  const period = `${preview.startsOn} to ${preview.endsOn}`;
  const pages: PDFPage[] = [];
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pages.push(page);
  drawPageHeader(page, preview.title, centerName, period, false, bold, regular);

  const metricWidth = (TABLE_WIDTH - 20) / 3;
  preview.metrics.slice(0, 3).forEach((metric, index) => {
    const x = MARGIN + index * (metricWidth + 10);
    page.drawRectangle({ x, y: 405, width: metricWidth, height: 70, color: pale, borderColor: border, borderWidth: 0.7 });
    page.drawText(printable(metric.value), { x: x + 14, y: 437, size: 19, font: bold, color: navy });
    page.drawText(printable(metric.label), { x: x + 14, y: 419, size: 9, font: regular, color: muted });
  });

  let y = drawTableHeader(page, preview.columns, 379, bold);
  const cellWidth = TABLE_WIDTH / preview.columns.length;
  for (const [index, row] of preview.rows.entries()) {
    const cells = preview.columns.map((_, column) => wrap(row[column] ?? "", column === 0 ? bold : regular, 8.2, cellWidth - 18));
    const height = Math.max(27, 12 + Math.max(...cells.map((lines) => lines.length)) * 12);
    if (height > PAGE_HEIGHT - 180) throw new Error("A report row is too long to fit on a PDF page");
    if (y - height < 52) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pages.push(page);
      drawPageHeader(page, preview.title, centerName, period, true, bold, regular);
      y = drawTableHeader(page, preview.columns, PAGE_HEIGHT - 116, bold);
    }
    if (index % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - height, width: TABLE_WIDTH, height, color: pale });
    cells.forEach((lines, column) => {
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: MARGIN + column * cellWidth + 9,
          y: y - 17 - lineIndex * 12,
          size: 8.2,
          font: column === 0 ? bold : regular,
          color: column === 0 ? navy : muted,
        });
      });
    });
    page.drawLine({ start: { x: MARGIN, y: y - height }, end: { x: PAGE_WIDTH - MARGIN, y: y - height }, thickness: 0.5, color: border });
    y -= height;
  }
  if (preview.rows.length === 0) {
    page.drawText(printable(preview.emptyHint), { x: MARGIN + 12, y: y - 25, size: 10, font: regular, color: muted });
  }
  pages.forEach((sheet, index) => {
    sheet.drawLine({ start: { x: MARGIN, y: 39 }, end: { x: PAGE_WIDTH - MARGIN, y: 39 }, thickness: 0.7, color: border });
    sheet.drawText(`Generated ${preview.generatedAt.slice(0, 19).replace("T", " ")} UTC`, { x: MARGIN, y: 23, size: 8, font: regular, color: muted });
    const label = `Page ${index + 1} of ${pages.length}`;
    sheet.drawText(label, { x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(label, 8), y: 23, size: 8, font: regular, color: muted });
  });
  doc.setTitle(`${preview.title} - ${period}`);
  doc.setCreator("DailyLog");
  return doc.save();
}
