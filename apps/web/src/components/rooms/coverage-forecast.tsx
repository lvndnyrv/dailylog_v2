"use client";
import { useEffect, useState, useTransition } from "react";
import type { RoomLiveStatus } from "@dailylog/db/queries";
import { deleteRecurringBookingAction, roomForecastAction, saveAttendanceBookingsAction, saveRecurringBookingAction } from "@/lib/rooms/actions";
import { addDateDays } from "@/lib/center-date";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { CoveragePlanReview } from "./coverage-plan-review";
import { AssignFloaterModal } from "./assign-floater-modal";
import { PlannedBreaks } from "./planned-breaks";

type Planning = Awaited<ReturnType<typeof roomForecastAction>>;
type Slot = Planning["rows"][number];
type AssignmentSeed = Pick<Slot, "room_id" | "starts_at" | "ends_at"> & {
  requiredAdditional: number;
};
const input = "min-w-0 rounded-xl border border-[#D6E1F0] bg-white p-2 text-[12px] text-ink";

export function CoverageForecast({ rooms, today, timeZone, openingHours, initialDate, focusAssignmentId }: { rooms: RoomLiveStatus[]; today: string; timeZone: string; openingHours: { start: string; end: string }; initialDate?: string; focusAssignmentId?: string }) {
  const latestDate = addDateDays(today, 90);
  const safeInitialDate = initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) && initialDate >= today && initialDate <= latestDate
    ? initialDate
    : today;
  const [date, setDate] = useState(safeInitialDate);
  const [revision, setRevision] = useState(0);
  const key = `${date}/${revision}`;
  const [loaded, setLoaded] = useState<{ key: string; data: Planning } | null>(null);
  const [editing, setEditing] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [assign, setAssign] = useState<AssignmentSeed | null>(null);
  // Keep same-day content mounted during refresh so an open review dialog is not lost.
  const data = loaded?.key.split("/")[0] === date ? loaded.data : null;
  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible" && !editing && !recurring && !assign) setRevision(value => value + 1); };
    const timer = setInterval(refreshVisible, 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [editing, recurring, assign]);
  useEffect(() => {
    let cancelled = false;
    roomForecastAction(date).then(data => { if (!cancelled) setLoaded({ key, data }); }).catch(() => {
      if (!cancelled) setLoaded({ key, data: { rows: [], children: [], bookings: [], patterns: [], review: [], shifts: [], error: "Forecast unavailable. Please refresh." } });
    });
    return () => { cancelled = true; };
  }, [date, key]);
  const time = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  const gaps = (data?.rows ?? []).filter(row => row.required_staff > row.scheduled_staff);
  const refresh = () => setRevision(r => r + 1);
  return <section className="rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card p-[18px]">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="w-full text-[15px] font-extrabold text-ink sm:w-auto">Coverage forecast</h2>
      <input aria-label="Forecast date" type="date" value={date} min={today} max={addDateDays(today,90)} onChange={e => { if(e.target.value) setDate(e.target.value); }} className={input} />
      <button type="button" onClick={refresh} className="min-h-10 rounded-xl border border-[#D6E1F0] px-3 text-[12px] font-bold text-primary">Refresh</button>
      <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
        <button type="button" disabled={!data || Boolean(data.error)} onClick={() => setRecurring(true)} className="min-h-10 rounded-xl border border-[#D6E1F0] px-3 text-[12px] font-bold text-primary disabled:opacity-50">Recurring schedules</button>
        <button type="button" disabled={!data || Boolean(data.error)} onClick={() => setEditing(true)} className="min-h-10 rounded-xl border border-[#D6E1F0] px-3 text-[12px] font-bold text-primary disabled:opacity-50">Plan selected day</button>
      </div>
    </div>
    <p className="my-3 text-[11.5px] leading-relaxed text-muted">Planning only — not live attendance. Unknown bookings are counted for the whole day; reported absences are excluded. Planned room moves are assumptions until completed. Only published, eligible staffing with known break timing counts as confirmed. Pending invitations reserve the educator in the source room but do not confirm destination coverage.</p>
    {!data ? <p role="status" className="text-[12px] text-muted">Checking bookings, absences, breaks and shared rooms…</p> : data.error ? <Notice tone="error">{data.error}</Notice> : <>
      <div className="grid gap-2 sm:grid-cols-2">{rooms.map(room => {
        const rows = data.rows.filter(row => row.room_id === room.id);
        return <div key={room.id} className="rounded-xl border border-[#EDF3FB] p-3"><b className="text-[12.5px] text-ink">{room.name}</b><p className="mt-1 text-[11px] text-muted">{rows.length ? `Peak ${Math.max(...rows.map(r => r.expected_children))} children · ${Math.max(...rows.map(r => r.unknown_bookings))} unknown bookings` : "No standalone forecast — closed, unopened or counted in host room"}</p></div>;
      })}</div>
      <PlannedBreaks shifts={data.shifts} date={date} timeZone={timeZone} compact onSaved={refresh} />
      <details className="mt-3" open><summary className="cursor-pointer text-[12.5px] font-bold text-ink">{gaps.length} intervals need coverage review</summary>
        <div className="mt-2 flex max-h-[320px] flex-col gap-2 overflow-auto">{gaps.map(row => <div key={row.room_id+row.starts_at} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#EFD9B5] bg-[#FFFBF4] p-3"><div className="min-w-0 flex-1"><b className="text-[12px] text-ink">{rooms.find(r => r.id===row.room_id)?.name} · {time(row.starts_at)}–{time(row.ends_at)}</b><p className="text-[11px] text-muted">{row.expected_children} children · {row.scheduled_staff}/{row.required_staff} confirmed educators · 1:{row.ratio}{row.unknown_bookings ? ` · ${row.unknown_bookings} unknown bookings` : ""}{row.uncertain_staff ? ` · ${row.uncertain_staff} untimed breaks` : ""}{row.pending_staff ? ` · ${row.pending_staff} invitations pending` : ""}</p></div><button type="button" onClick={() => setAssign({ room_id: row.room_id, starts_at: row.starts_at, ends_at: row.ends_at, requiredAdditional: Math.max(1,row.required_staff-row.scheduled_staff) })} className="min-h-10 shrink-0 rounded-xl border border-[#EFD9B5] px-3 text-[12px] font-bold text-primary">Fix coverage</button></div>)}
        {!gaps.length && <p className="text-[12px] text-muted">No gaps in the available planning inputs. Confirm bookings and refresh after schedule changes.</p>}</div>
      </details>
      <CoveragePlanReview
        rows={data.review}
        roomNames={Object.fromEntries(rooms.map(room => [room.id,room.name]))}
        timeZone={timeZone}
        focusAssignmentId={focusAssignmentId}
        onChanged={refresh}
        onReplace={row => setAssign({ room_id: row.room_id, starts_at: row.starts_at, ends_at: row.ends_at, requiredAdditional: 1 })}
      />
    </>}
    {editing && data && <BookingEditor data={data} rooms={rooms} date={date} hours={openingHours} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />}
    {recurring && data && <RecurringBookingEditor data={data} rooms={rooms} today={today} hours={openingHours} onClose={() => setRecurring(false)} onSaved={() => { setRecurring(false); refresh(); }} />}
    {assign && <AssignFloaterModal rooms={rooms} floaters={[]} shifts={[]} initialEducatorId={null} initialRoomId={assign.room_id} date={today} initialDate={date} initialStart={time(assign.starts_at)} initialEnd={time(assign.ends_at)} requiredAdditional={assign.requiredAdditional} timeZone={timeZone} onClose={() => { setAssign(null); refresh(); }} />}
  </section>;
}

function BookingEditor({ data, rooms, date, hours, onClose, onSaved }: { data: Planning; rooms: RoomLiveStatus[]; date: string; hours: { start: string; end: string }; onClose: () => void; onSaved: () => void }) {
  const [values,setValues] = useState(data.children.map(child => {
    const b = data.bookings.find(b => b.child_id===child.id);
    return { child_id: child.id, state: !b ? "unknown" : b.expected ? "expected" : "not_scheduled", arrives_at: b?.arrives_at?.slice(0,5) ?? hours.start.slice(0,5), leaves_at: b?.leaves_at?.slice(0,5) ?? hours.end.slice(0,5) };
  }));
  const [error,setError]=useState("");
  const [pending,run]=useTransition();
  const change=(index:number,field:string,value:string)=>setValues(rows=>rows.map((r,i)=>i===index?{...r,[field]:value}:r));
  return <Modal width={760} onClose={() => { if (!pending) onClose(); }}><h2 className="text-[19px] font-extrabold text-ink">Selected-day bookings · {date}</h2><p className="text-[12px] text-muted">A choice here overrides the child&apos;s recurring schedule for this date. Unknown is not the same as absent. Planning records do not check children in, change tuition, or cancel an absence report.</p>
    <form className="flex flex-col gap-4" onSubmit={e=>{e.preventDefault();run(async()=>{try { const result=await saveAttendanceBookingsAction(date,values);if(result.error)setError(result.error);else onSaved(); }catch{setError("Bookings could not be saved. Please retry.");}});}}>
      <fieldset disabled={pending} className="flex min-w-0 max-h-[440px] flex-col gap-3 overflow-auto">{values.map((value,index)=>{const child=data.children[index];return <div key={child.id} className="grid items-end gap-2 border-b border-[#EDF3FB] pb-3 sm:grid-cols-[1.2fr_1fr_.8fr_.8fr]"><span className="text-[12px] text-ink"><b>{child.first_name} {child.last_name}</b><span className="block text-[10.5px] text-muted">{rooms.find(r=>r.id===child.classroom_id)?.name ?? "Room not assigned"}</span></span><label className="flex min-w-0 flex-col text-[10px] text-muted">Plan<select aria-label={`Plan for ${child.first_name} ${child.last_name}`} className={input} value={value.state} onChange={e=>change(index,"state",e.target.value)}><option value="unknown">Unknown</option><option value="expected">Expected</option><option value="not_scheduled">Not scheduled</option></select></label><label className="flex min-w-0 flex-col text-[10px] text-muted">Arrival<input aria-label={`Arrival for ${child.first_name} ${child.last_name}`} type="time" className={input} disabled={value.state!=="expected"} required={value.state==="expected"} value={value.arrives_at} onChange={e=>change(index,"arrives_at",e.target.value)} /></label><label className="flex min-w-0 flex-col text-[10px] text-muted">Pickup<input aria-label={`Pickup for ${child.first_name} ${child.last_name}`} type="time" className={input} disabled={value.state!=="expected"} required={value.state==="expected"} value={value.leaves_at} onChange={e=>change(index,"leaves_at",e.target.value)} /></label></div>;})}</fieldset>
      {error && <Notice tone="error">{error}</Notice>}<div className="flex gap-3"><Button type="button" variant="secondary" className="flex-1" disabled={pending} onClick={onClose}>Cancel</Button><Button type="submit" className="flex-1" disabled={pending}>{pending?"Saving…":"Save bookings"}</Button></div>
    </form></Modal>;
}

const weekdays = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" },
  { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

function RecurringBookingEditor({ data, rooms, today, hours, onClose, onSaved }: { data: Planning; rooms: RoomLiveStatus[]; today: string; hours: { start: string; end: string }; onClose: () => void; onSaved: () => void }) {
  const initialChildId = data.children[0]?.id ?? "";
  const valuesFor = (id: string) => {
    const current = data.patterns.find(item => item.child_id === id);
    return current ? {
      weekdays: current.weekdays,
      arrivesAt: current.arrives_at.slice(0,5),
      leavesAt: current.leaves_at.slice(0,5),
      startsOn: current.starts_on,
      endsOn: current.ends_on ?? "",
    } : { weekdays: [1,2,3,4,5], arrivesAt: hours.start.slice(0,5), leavesAt: hours.end.slice(0,5), startsOn: today, endsOn: "" };
  };
  const [childId, setChildId] = useState(initialChildId);
  const [values, setValues] = useState(() => valuesFor(initialChildId));
  const [error, setError] = useState("");
  const [pending, run] = useTransition();
  const pattern = data.patterns.find(item => item.child_id === childId);

  const child = data.children.find(item => item.id === childId);
  const toggleDay = (day: number) => setValues(current => ({
    ...current,
    weekdays: current.weekdays.includes(day) ? current.weekdays.filter(value => value !== day) : [...current.weekdays, day].sort(),
  }));
  const save = () => run(async () => {
    setError("");
    try {
      const result = await saveRecurringBookingAction({ childId, ...values });
      if (result.error) setError(result.error); else onSaved();
    } catch { setError("Recurring schedule could not be saved. Please retry."); }
  });
  const remove = () => run(async () => {
    setError("");
    try {
      const result = await deleteRecurringBookingAction(childId);
      if (result.error) setError(result.error); else onSaved();
    } catch { setError("Recurring schedule could not be removed. Please retry."); }
  });

  return <Modal width={620} onClose={() => { if (!pending) onClose(); }}>
    <h2 className="text-[19px] font-extrabold text-ink">Recurring attendance schedule</h2>
    <p className="text-[12px] text-muted">Set the usual expected days and times for staffing forecasts. A selected-day booking can override this pattern. Tuition remains governed by the accepted enrollment agreement.</p>
    <fieldset disabled={pending} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-[11px] font-bold text-ink">Child
        <select className={input} value={childId} onChange={event => { const id = event.target.value; setChildId(id); setValues(valuesFor(id)); setError(""); }}>
          {data.children.map(item => <option key={item.id} value={item.id}>{item.first_name} {item.last_name} · {rooms.find(room => room.id === item.classroom_id)?.name ?? "No room"}</option>)}
        </select>
      </label>
      <div><span className="text-[11px] font-bold text-ink">Expected weekdays</span><div className="mt-2 flex flex-wrap gap-2">{weekdays.map(day => <button key={day.value} type="button" aria-pressed={values.weekdays.includes(day.value)} onClick={() => toggleDay(day.value)} className={`rounded-full border px-3 py-2 text-[11px] font-bold ${values.weekdays.includes(day.value) ? "border-primary bg-[#EAF3FF] text-primary" : "border-[#D6E1F0] text-muted"}`}>{day.label}</button>)}</div></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-[11px] font-bold text-ink">Arrival<input className={input} type="time" required value={values.arrivesAt} onChange={event => setValues(current => ({ ...current, arrivesAt: event.target.value }))} /></label><label className="flex flex-col gap-1 text-[11px] font-bold text-ink">Pickup<input className={input} type="time" required value={values.leavesAt} onChange={event => setValues(current => ({ ...current, leavesAt: event.target.value }))} /></label></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-[11px] font-bold text-ink">Starts<input className={input} type="date" required value={values.startsOn} onChange={event => setValues(current => ({ ...current, startsOn: event.target.value }))} /></label><label className="flex flex-col gap-1 text-[11px] font-bold text-ink">Ends <span className="font-normal text-muted">optional</span><input className={input} type="date" min={values.startsOn} value={values.endsOn} onChange={event => setValues(current => ({ ...current, endsOn: event.target.value }))} /></label></div>
      {pattern && <p className="rounded-xl bg-[#F4F8FE] p-3 text-[11px] text-muted">Editing the current schedule for {child?.first_name}. Saving replaces the existing pattern; removing it returns future unplanned dates to “unknown.”</p>}
    </fieldset>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="flex flex-wrap gap-3">{pattern && <Button type="button" variant="secondary" disabled={pending} onClick={remove}>Remove schedule</Button>}<Button type="button" variant="secondary" className="ml-auto" disabled={pending} onClick={onClose}>Cancel</Button><Button type="button" disabled={pending || !childId || !values.weekdays.length} onClick={save}>{pending ? "Saving…" : "Save schedule"}</Button></div>
  </Modal>;
}
