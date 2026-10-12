"use client";

import { useEffect } from "react";
import { reportWebClientError } from "@/lib/client-errors";

export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("DailyLog admin page failed", error);
    void reportWebClientError("admin_render_failure", error.digest);
  }, [error]);

  return (
    <main className="grid min-h-[70vh] place-items-center p-8">
      <section className="w-full max-w-md rounded-[22px] border border-hairline bg-card p-7 text-center shadow-[0_14px_40px_rgba(23,51,91,.12)]">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-primary-soft text-2xl text-primary">
          ↻
        </div>
        <h1 className="mt-5 text-xl font-extrabold text-ink">This page needs another try</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Nothing was deleted. Retry the page, or return to the dashboard if the problem continues.
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="rounded-btn bg-primary px-4 py-3 text-sm font-bold text-white hover:bg-primary-hover"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded-btn border-[1.5px] border-hairline px-4 py-3 text-sm font-bold text-ink hover:bg-canvas"
          >
            Return to dashboard
          </a>
        </div>
      </section>
    </main>
  );
}
