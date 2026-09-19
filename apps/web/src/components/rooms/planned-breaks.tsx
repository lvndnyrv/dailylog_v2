"use client";
import type { StaffShiftRow } from "@dailylog/db/queries";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPlannedBreakAction } from "@/lib/rooms/actions";
import { dateInTimeZone } from "@/lib/center-date";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export function PlannedBreaks({ shifts, date, timeZone }: { shifts: StaffShiftRow[]; date: string; timeZone: string }) {
  const [selected, setSelected] = useState<StaffShiftRow | null>(null);
  const published = shifts.filter(s => s.status === "published" && dateInTimeZone(s.starts_at, timeZone) === date);
  const time = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  return <section className="rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card p-[18px]">
    <details><summary className="cursor-pointer text-[14px] font-extrabold text-ink">Plan today&apos;s breaks · {published.length} published shifts</summary>
      <p className="my-3 text-[11.5px] text-muted">Set when the educator will be away, then assign someone else to cover. This does not change payroll break minutes or live clock-in status.</p>
      {published.map(s => <div key={s.id} className="flex items-center justify-between gap-3 border-t border-[#EDF3FB] py-3"><span className="text-[12px] text-ink"><b>{s.staff?.profile?.full_name}</b> · {time(s.starts_at)}–{time(s.ends_at)}<span className="block text-[11px] text-muted">{s.planned_break_starts_at && s.planned_break_ends_at ? `Break ${time(s.planned_break_starts_at)}–${time(s.planned_break_ends_at)}` : s.unpaid_break_minutes ? `${s.unpaid_break_minutes} payroll break minutes · timing not set` : "No planned break"}</span></span><button type="button" className="text-[12px] font-bold text-primary" onClick={() => setSelected(s)}>Set break</button></div>)}
      {!published.length && <p className="text-[12px] text-muted">Publish a staff schedule to plan breaks here.</p>}
    </details>
    {selected && <BreakEditor key={selected.id} shift={selected} time={time} onClose={() => setSelected(null)} />}
  </section>;
}

function BreakEditor({ shift, time, onClose }: { shift: StaffShiftRow; time: (value: string) => string; onClose: () => void }) {
  const router = useRouter();
  const [start, setStart] = useState(shift.planned_break_starts_at ? time(shift.planned_break_starts_at) : "");
  const [end, setEnd] = useState(shift.planned_break_ends_at ? time(shift.planned_break_ends_at) : "");
  const [error, setError] = useState("");
  const [pending, run] = useTransition();
  const save = (clear = false) => run(async () => {
    try {
      const result = await setPlannedBreakAction(shift.id, clear ? "" : start, clear ? "" : end);
      if (result.error) { setError(result.error); return; }
      router.refresh(); onClose();
    } catch { setError("The break could not be saved. Please retry."); }
  });
  return <Modal width={420} onClose={onClose}><h2 className="text-[19px] font-extrabold text-ink">Plan a break</h2><p className="text-[12px] text-muted">{shift.staff?.profile?.full_name} · shift {time(shift.starts_at)}–{time(shift.ends_at)}</p>
    <form onSubmit={e => { e.preventDefault(); save(); }} className="flex flex-col gap-4"><div className="grid grid-cols-2 gap-3">{["Starts", "Ends"].map((label, i) => <label key={label} className="min-w-0 text-[13px] font-bold text-ink">{label}<input type="time" required value={i ? end : start} onChange={e => i ? setEnd(e.target.value) : setStart(e.target.value)} className="w-full min-w-0 rounded-xl border border-[#D6E1F0] p-3" /></label>)}</div>
      {error && <Notice tone="error">{error}</Notice>}<div className="flex gap-3"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>Save break</Button></div>
      {shift.planned_break_starts_at && <button type="button" disabled={pending} onClick={() => save(true)} className="text-[12px] font-bold text-danger">Remove planned break</button>}
    </form></Modal>;
}
