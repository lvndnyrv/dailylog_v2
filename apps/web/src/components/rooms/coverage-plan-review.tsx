"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cancelCoverageAction, type roomForecastAction } from "@/lib/rooms/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

type Review = Awaited<ReturnType<typeof roomForecastAction>>["review"][number];

export function CoveragePlanReview({ rows, roomNames, timeZone, focusAssignmentId, onChanged, onReplace }: {
  rows: Review[]; roomNames: Record<string,string>; timeZone: string; focusAssignmentId?: string; onChanged: () => void; onReplace: (row: Review) => void;
}) {
  const [cancelling,setCancelling] = useState<Review | null>(null);
  const [error,setError] = useState("");
  const [pending,run] = useTransition();
  const focused = useRef(false);
  const time = (date:string) => new Intl.DateTimeFormat("en-GB", {timeZone,hour:"2-digit",minute:"2-digit"}).format(new Date(date));
  useEffect(() => {
    if (!focusAssignmentId || focused.current || !rows.some(row => row.assignment_id === focusAssignmentId)) return;
    focused.current = true;
    document.getElementById(`coverage-assignment-${focusAssignmentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusAssignmentId, rows]);
  return <section className="mt-4 border-t border-[#D6E1F0] pt-4">
    <h3 className="text-[14px] font-bold text-ink">Existing coverage · {rows.filter(row => row.reason).length} need review</h3>
    <p className="my-2 text-[11.5px] text-muted">Rechecked on refresh and every minute while this page is visible. New bookings, leave, shifts and invitation responses can change the result. Nothing is cancelled automatically.</p>
    {!rows.length ? <p className="text-[12px] text-muted">No remaining coverage assignments for this date.</p> : <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto">{rows.map(row => <div id={`coverage-assignment-${row.assignment_id}`} key={row.assignment_id} className={"flex flex-wrap items-center gap-3 rounded-xl border p-3 " + (row.assignment_id === focusAssignmentId ? "ring-2 ring-primary " : "") + (row.reason ? "border-[#EFD9B5] bg-[#FFFBF4]" : "border-[#EDF3FB]")}>
      <div className="min-w-0 flex-1"><b className="text-[12px] text-ink">{row.full_name} · {roomNames[row.room_id] ?? "Room"}</b><p className="text-[11.5px] text-muted">{time(row.starts_at)}–{time(row.ends_at)} · {row.status === "assigned" ? "Invitation pending" : row.status.charAt(0).toUpperCase() + row.status.slice(1)}</p><p className="text-[11.5px] text-ink">{row.reason || "No conflict found in current planning inputs."}</p></div>
      <div className="flex items-center gap-3">{row.reason && <button type="button" className="text-[12px] font-bold text-primary" onClick={() => onReplace(row)}>Find replacement</button>}<button type="button" className="text-[12px] font-bold text-primary" onClick={() => {setError("");setCancelling(row);}}>Cancel assignment</button></div>
    </div>)}</div>}
    {cancelling && <Modal onClose={() => {if(!pending)setCancelling(null);}}>
      <h2 className="text-[19px] font-extrabold text-ink">Cancel this coverage?</h2>
      <p className="text-[13px] text-muted">{cancelling.full_name} · {time(cancelling.starts_at)}–{time(cancelling.ends_at)}. The educator will be notified. This removes their coverage commitment and may reopen a staffing gap; use Fix coverage to plan a replacement.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-3"><Button type="button" variant="secondary" disabled={pending} onClick={() => setCancelling(null)}>Keep assignment</Button><Button type="button" disabled={pending} onClick={() => run(async()=>{
        try {const result=await cancelCoverageAction(cancelling.assignment_id); if(result.error)setError(result.error);else{setCancelling(null);onChanged();}}
        catch {setError("Cancellation could not be confirmed. Retry or refresh to check the assignment.");}
      })}>{pending ? "Cancelling…" : "Cancel assignment"}</Button></div>
    </Modal>}
  </section>;
}
