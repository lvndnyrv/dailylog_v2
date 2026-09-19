"use client";

import type { RoomLiveStatus, StaffShiftRow } from "@dailylog/db/queries";
import { useEffect, useState, useTransition } from "react";
import { saveCoveragePlanAction, coverageCandidatesAction, type RoomActionState } from "@/lib/rooms/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { addDateDays } from "@/lib/center-date";

type Candidate = Awaited<ReturnType<typeof coverageCandidatesAction>>["candidates"][number];
const input = "min-w-0 w-full rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-3 py-3 text-[13px] text-ink outline-none focus:border-primary";

export function AssignFloaterModal({ rooms, initialEducatorId, initialRoomId, date, timeZone, onClose, initialDate, initialStart, initialEnd, requiredAdditional = 1 }: {
  floaters: { id: string; full_name: string }[];
  rooms: RoomLiveStatus[];
  shifts: StaffShiftRow[];
  initialEducatorId: string | null;
  initialRoomId?: string | null;
  date: string;
  timeZone: string;
  onClose: () => void;
  initialDate?: string;
  initialStart?: string;
  initialEnd?: string;
  requiredAdditional?: number;
}) {
  const [state, setState] = useState<RoomActionState>({});
  const [pending, run] = useTransition();
  const [requestId] = useState(() => crypto.randomUUID());
  const [uncertainSave, setUncertainSave] = useState(false);
  const [draft, setDraft] = useState<{ profile_id: string; name: string; start: string; end: string; confirm: boolean; notes: string }[]>([]);
  const [notifyLead, setNotifyLead] = useState(true);
  const [educatorId, setEducatorId] = useState(initialEducatorId ?? "");
  const [roomId, setRoomId] = useState(initialRoomId ?? "");
  const [day, setDay] = useState(initialDate ?? date);
  const [start, setStart] = useState(initialStart ?? "12:00");
  const [end, setEnd] = useState(initialEnd ?? "14:00");
  const key = [roomId, day, start, end].join("/");
  const [result, setResult] = useState<{ key: string; candidates: Candidate[]; error?: string } | null>(null);
  const ready = result?.key === key;
  const candidates = ready ? result.candidates.map(item => draft.some(segment => segment.profile_id === item.profile_id && segment.start < end && segment.end > start)
    ? { ...item, available: false, reason: "Already included in this draft during this interval" } : item) : [];
  const educator = candidates.find(item => item.profile_id === educatorId);
  const valid = Boolean(roomId && day && start && end && end > start);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      coverageCandidatesAction(roomId, day, start, end)
        .then(value => { if (!cancelled) setResult({ key, ...value }); })
        .catch(() => { if (!cancelled) setResult({ key, candidates: [], error: "Availability could not be checked. Change the interval to retry." }); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [roomId, day, start, end, key, valid]);

  const points = initialStart && initialEnd && roomId === initialRoomId && day === (initialDate ?? date) ? [...new Set([initialStart, initialEnd, ...draft.flatMap(s => [s.start, s.end])])].filter(t => t >= initialStart && t <= initialEnd).sort() : [];
  const draftCoversGap = points.length > 1 && points.slice(0,-1).every(t => draft.filter(s => s.start <= t && s.end > t).length >= requiredAdditional);
  const save = () => run(async () => {
    setState({});
    try {
      const result = await saveCoveragePlanAction(requestId, roomId, day, draft.map(({ profile_id, start, end, confirm, notes }) => ({ profile_id, start, end, confirm, notes })), notifyLead);
      setState(result);
      setUncertainSave(false);
    } catch {
      setUncertainSave(true);
      setState({ error: "The save result could not be confirmed. Retry this same plan safely, or close and refresh to check it." });
    }
  });
  return <Modal onClose={() => { if (!pending) onClose(); }} width={600}>
    <div><h2 className="text-[19px] font-extrabold text-ink">Assign room coverage</h2>
      <p className="mt-1 text-[12.5px] text-muted">Split a gap between educators, or add overlapping segments when more than one is needed. Home-room assignments stay unchanged. Times use {timeZone}.</p></div>
    {state.ok ? <><Notice tone="success">{draft.length} coverage segments assigned for {day}. Educators receive invitations to accept; pending invitations are not confirmed coverage.</Notice><Button type="button" onClick={onClose}>Done</Button></> :
      <><form className="flex flex-col gap-4" onSubmit={event => {
        event.preventDefault();
        if (!educator?.available || draft.length >= 12) return;
        const form = new FormData(event.currentTarget);
        setDraft(rows => [...rows, { profile_id: educator.profile_id, name: educator.full_name, start, end, confirm: form.get("confirm_availability") === "on", notes: String(form.get("notes") ?? "") }]);
        setEducatorId(""); setState({});
      }}><fieldset disabled={pending || uncertainSave} className="flex min-w-0 flex-col gap-4">
        <label className="text-[13px] font-bold text-ink">Room
          <select name="room_id" disabled={draft.length > 0} value={roomId} onChange={e => setRoomId(e.target.value)} required className={input}>
            <option value="">Choose a room</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select></label>
        <label className="text-[13px] font-bold text-ink">Date
          <input name="date" type="date" disabled={draft.length > 0} value={day} min={date} max={addDateDays(date,90)} onChange={e => setDay(e.target.value)} required className={input} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="min-w-0 text-[13px] font-bold text-ink">Starts<input name="starts_at" type="time" value={start} onChange={e => setStart(e.target.value)} required className={input} /></label>
          <label className="min-w-0 text-[13px] font-bold text-ink">Ends<input name="ends_at" type="time" value={end} onChange={e => setEnd(e.target.value)} required className={input} /></label>
        </div>
        <fieldset><legend className="mb-2 text-[13px] font-bold text-ink">Educator availability</legend>
          {!valid ? <p className="text-[12px] text-muted">Choose a room, date and valid time interval.</p> : !ready ? <p role="status" className="text-[12px] text-muted">Checking shifts, leave and breaks…</p> : result.error ? <Notice tone="error">{result.error}</Notice> :
            <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto">
              {candidates.map(item => <label key={item.profile_id} className={"flex items-center gap-3 rounded-[13px] border p-3 " + (!item.available ? "border-[#EDF3FB] bg-canvas" : educatorId === item.profile_id ? "border-primary bg-tint" : "border-[#D6E1F0]")}>
                <input type="radio" name="educator_id" value={item.profile_id} disabled={!item.available} checked={educatorId === item.profile_id} onChange={() => setEducatorId(item.profile_id)} required />
                <Avatar name={item.full_name} size={30} /><span className="min-w-0 flex-1"><span className="block text-[12.5px] font-bold text-ink">{item.full_name}</span><span className="block text-[11px] text-muted">{item.reason}</span></span>
              </label>)}
              {candidates.length === 0 && <p className="text-[12px] text-muted">No educators found for this center. Invite staff from the Staff page.</p>}
            </div>}
        </fieldset>
        {educator?.needs_confirmation && <label key={key + educatorId} className="flex items-start gap-2 rounded-xl bg-warning-bg p-3 text-[12px] text-ink"><input className="mt-0.5" type="checkbox" name="confirm_availability" required />I confirmed this educator is available for the whole interval, including break timing.</label>}
        <label className="text-[13px] font-bold text-ink">Coverage note (optional)<input name="notes" placeholder="Lunch break, sick coverage…" className={input} /></label>
        <p className="text-[11px] text-muted">Add each segment to the draft below. Nothing is saved or sent until you assign the plan. Remove all segments to change the room or date.</p>
        <Button type="submit" variant="secondary" disabled={pending || !ready || !educator?.available || draft.length >= 12}>Add segment to plan</Button>
        </fieldset></form>
        {draft.length > 0 && <section className="flex flex-col gap-3 rounded-xl border border-[#D6E1F0] bg-tint p-3">
          <h3 className="text-[13px] font-bold text-ink">Draft plan · {draft.length} {draft.length === 1 ? "segment" : "segments"}</h3>
          {draft.map((segment,index) => <div key={index} className="flex items-center gap-2 text-[12px] text-ink"><span className="min-w-0 flex-1"><b>{segment.name}</b> · {segment.start}–{segment.end}</span><button type="button" disabled={pending || uncertainSave} onClick={() => setDraft(rows => rows.filter((_,i) => i !== index))} className="font-bold text-primary disabled:opacity-50" aria-label={`Remove segment ${index+1}`}>Remove</button></div>)}
          {points.length > 1 && <p className="text-[12px] text-ink">{draftCoversGap ? "Draft spans the requested gap. Final source-room safety is rechecked when saved; coverage still needs acceptance." : "This draft does not yet cover every part of the requested gap. You can save a partial plan; remaining gaps stay visible."}</p>}
          <label className="flex items-start gap-2 text-[12px] text-ink"><input type="checkbox" checked={notifyLead} disabled={pending || uncertainSave} onChange={e => setNotifyLead(e.target.checked)} />Notify the room lead, if one is configured</label>
        </section>}
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="flex gap-3"><Button type="button" variant="secondary" className="flex-1" disabled={pending} onClick={onClose}>Cancel</Button><Button type="button" className="flex-1" onClick={save} disabled={pending || !draft.length}>{pending ? "Assigning…" : uncertainSave ? "Retry same plan" : draft.length === 1 ? "Assign 1 segment" : `Assign ${draft.length || ""} segments`}</Button></div>
      </>}
  </Modal>;
}
