"use client";

import { useEffect } from "react";
import { reportWebClientError } from "@/lib/client-errors";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("DailyLog web application failed", error);
    void reportWebClientError("global_render_failure", error.digest);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#F4F8FD", color: "#17335B" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ width: "100%", maxWidth: 430, boxSizing: "border-box", border: "1px solid #D6E1F0", borderRadius: 22, background: "#fff", padding: 28, textAlign: "center", boxShadow: "0 14px 40px rgba(23,51,91,.14)" }}>
            <div style={{ width: 68, height: 68, margin: "0 auto", display: "grid", placeItems: "center", borderRadius: 34, background: "#E3EDFA", color: "#2F7CD8", fontSize: 30 }}>↻</div>
            <h1 style={{ margin: "20px 0 8px", fontSize: 22 }}>DailyLog needs a fresh start</h1>
            <p style={{ margin: 0, color: "#5B6B82", fontSize: 14, lineHeight: 1.6 }}>
              Nothing you already saved was removed. Reload DailyLog and try that action again.
            </p>
            <button type="button" onClick={reset} style={{ width: "100%", marginTop: 24, border: 0, borderRadius: 10, background: "#2F7CD8", color: "white", padding: "13px 16px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
              Reload DailyLog
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
