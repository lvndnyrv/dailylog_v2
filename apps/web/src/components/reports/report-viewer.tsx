import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReportPreview } from "@/lib/reports/data";
import { REPORT_CATALOG } from "@/lib/reports/catalog";
import { ReportExportButtons } from "./report-export-buttons";

const metricTone = {
  default: "text-ink",
  warning: "text-warning-text",
  success: "text-success",
};

export function ReportViewer({ preview }: { preview: ReportPreview }) {
  const report = REPORT_CATALOG[preview.kind];
  return (
    <main className="flex-1 p-5 lg:p-7 print:p-0">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <Link
            href="/reports"
            className="grid size-10 place-items-center rounded-full border-[1.5px] border-[#D6E1F0] bg-white text-ink hover:bg-canvas"
            aria-label="Back to reports"
          >
            <ArrowLeft size={17} />
          </Link>
          <span className="min-w-0 flex-1">
            <span className="block text-[20px] font-extrabold text-ink">{preview.title}</span>
            <span className="block text-[12px] text-muted">{report.description}</span>
          </span>
          <form className="flex flex-wrap items-end gap-2" method="get">
            <label className="text-[11px] font-bold text-ink">
              From
              <input
                type="date"
                name="from"
                required
                defaultValue={preview.startsOn}
                className="mt-1 block rounded-xl border-[1.5px] border-[#D6E1F0] bg-white px-3 py-2 text-[12px]"
              />
            </label>
            <label className="text-[11px] font-bold text-ink">
              To
              <input
                type="date"
                name="to"
                required
                defaultValue={preview.endsOn}
                className="mt-1 block rounded-xl border-[1.5px] border-[#D6E1F0] bg-white px-3 py-2 text-[12px]"
              />
            </label>
            <button className="rounded-btn bg-primary px-4 py-[9px] text-[12px] font-bold text-white">
              Run report
            </button>
          </form>
        </div>

        <section className="rounded-[18px] border-[1.5px] border-[#D6E1F0] bg-white p-5 print:border-0 print:p-0">
          <div className="hidden print:block">
            <h1 className="text-2xl font-extrabold text-ink">{preview.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {preview.startsOn} through {preview.endsOn} · generated {new Date(preview.generatedAt).toLocaleString("en-CA")}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 print:mt-5 print:grid-cols-3">
            {preview.metrics.map((metric) => (
              <div key={metric.label} className="rounded-xl bg-canvas px-4 py-3 print:border print:border-[#D6E1F0] print:bg-white">
                <span className={`block text-[20px] font-extrabold ${metricTone[metric.tone ?? "default"]}`}>
                  {metric.value}
                </span>
                <span className="block text-[11px] text-muted">{metric.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border-[1.5px] border-[#D6E1F0]">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead className="bg-[#F8FBFE] text-[10px] tracking-[.07em] text-faint">
                <tr>
                  {preview.columns.map((column) => (
                    <th key={column} className="border-b border-[#EDF3FB] px-4 py-3 font-bold">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[12px] text-body">
                {preview.rows.map((row, rowIndex) => (
                  <tr key={`${row[0]}-${rowIndex}`} className="border-b border-[#EDF3FB] last:border-0">
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${cellIndex}-${cell}`}
                        className={`px-4 py-3 ${cellIndex === 0 ? "font-bold text-ink" : ""}`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!preview.rows.length && (
              <p className="p-6 text-center text-[13px] text-muted">{preview.emptyHint}</p>
            )}
          </div>
          <div className="mt-5 print:hidden">
            <ReportExportButtons preview={preview} />
          </div>
          <p className="mt-4 border-t border-[#EDF3FB] pt-3 text-[10.5px] leading-relaxed text-faint print:text-black">
            Built from the live center record. Corrections are reflected the next time this report runs;
            each export is recorded in the audit trail and Recent exports.
          </p>
        </section>
      </div>
    </main>
  );
}
