"use client";

import { useEffect, useState } from "react";
import { reviewRoomTransitionStaffing } from "@/lib/rooms/actions";
import { Notice } from "@/components/ui/notice";

type Result = Awaited<ReturnType<typeof reviewRoomTransitionStaffing>>;

export function TransitionStaffingReview({ planId }: { planId: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    reviewRoomTransitionStaffing(planId).then((value) => {
      if (active) setResult(value);
    }).catch(() => {
      if (active) setResult({ review: null, error: "Could not check move-day coverage. Try again." });
    });
    return () => { active = false; };
  }, [planId, refresh]);

  return <section aria-label="Move-day staffing review" className="space-y-2">
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <b className="text-ink">Move-day staffing</b>
      <button type="button" className="font-bold text-primary" onClick={() => { setResult(null); setRefresh((value) => value + 1); }}>Refresh</button>
    </div>
    {!result ? <p className="text-[12px] text-muted">Checking published coverage…</p> :
      <Notice tone={result.error || result.review?.status === "gap" ? "error" : "info"}>
        {result.error ?? result.review?.message ?? "No staffing forecast is available."}
      </Notice>}
    <p className="text-[11px] leading-relaxed text-muted">This is a conditional forecast, not a reservation or staffing approval. It uses current child bookings and published shifts; new enrollments, bookings, absences, leave or room plans can change it. Use Coverage forecast to plan replacement staff.</p>
  </section>;
}
