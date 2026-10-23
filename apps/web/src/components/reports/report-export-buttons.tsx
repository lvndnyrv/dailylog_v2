"use client";

import Link from "next/link";
import type { ReportPreview } from "@/lib/reports/data";
import { REPORT_CATALOG } from "@/lib/reports/catalog";

export function ReportExportButtons({ preview, canSchedule }: { preview: ReportPreview; canSchedule: boolean }) {
  const definition = REPORT_CATALOG[preview.kind];
  const params = new URLSearchParams({ from: preview.startsOn, to: preview.endsOn });
  const csvHref = `/reports-export/${definition.csvKind}?${params}`;
  const pdfHref = `/reports-export/${preview.kind}/pdf?${params}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {preview.exportBlockedReason ? (
        <span className="rounded-btn bg-primary/50 px-5 py-3 text-[13px] font-bold text-white">PDF locked · review entries</span>
      ) : (
        <a href={pdfHref} className="rounded-btn bg-primary px-5 py-3 text-[13px] font-bold text-white hover:opacity-90">
          Download PDF
        </a>
      )}
      {preview.exportBlockedReason ? (
        <span className="rounded-btn border-[1.5px] border-[#EFD9B5] bg-warning-bg px-4 py-3 text-[12px] font-bold text-warning-text">
          CSV locked · review entries
        </span>
      ) : (
        <a
          href={csvHref}
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-white px-5 py-3 text-[13px] font-bold text-ink hover:bg-canvas"
        >
          Download CSV
        </a>
      )}
      {canSchedule && (
        <Link
          href={`/reports?schedule=${preview.kind}`}
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-white px-5 py-3 text-[13px] font-bold text-ink hover:bg-canvas"
        >
          Schedule…
        </Link>
      )}
      {preview.kind === "attendance" && (
        <Link
          href={`/attendance-record?month=${preview.endsOn.slice(0, 7)}`}
          target="_blank"
          prefetch={false}
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-white px-5 py-3 text-[13px] font-bold text-ink hover:bg-canvas"
        >
          Monthly child records ↗
        </Link>
      )}
      {preview.exportBlockedReason && (
        <p className="basis-full text-[11.5px] text-warning-text">{preview.exportBlockedReason}</p>
      )}
    </div>
  );
}
