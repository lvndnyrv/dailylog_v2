"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { ReportPreview } from "@/lib/reports/data";
import { REPORT_CATALOG } from "@/lib/reports/catalog";
import { recordReportExport } from "@/lib/reports/actions";

export function ReportExportButtons({ preview }: { preview: ReportPreview }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const definition = REPORT_CATALOG[preview.kind];
  const params = new URLSearchParams({ from: preview.startsOn, to: preview.endsOn });
  const csvHref = `/reports-export/${definition.csvKind}?${params}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            const result = await recordReportExport(
              preview.kind,
              "pdf",
              preview.startsOn,
              preview.endsOn,
              preview.rowCount,
            );
            if (result.error) setError(result.error);
            else window.print();
          })
        }
        className="rounded-btn bg-primary px-5 py-3 text-[13px] font-bold text-white disabled:opacity-60"
      >
        {pending ? "Preparing…" : "Print / save PDF"}
      </button>
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
      <Link
        href="/reports"
        className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-white px-5 py-3 text-[13px] font-bold text-ink hover:bg-canvas"
      >
        Schedule…
      </Link>
      {preview.exportBlockedReason && (
        <p className="basis-full text-[11.5px] text-warning-text">{preview.exportBlockedReason}</p>
      )}
      {error && <p role="alert" className="basis-full text-[11.5px] text-danger">{error}</p>}
    </div>
  );
}
