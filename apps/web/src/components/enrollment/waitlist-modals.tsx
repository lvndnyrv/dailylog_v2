"use client";

import type {
  Enrollment,
  EnrollmentChildRow,
  EnrollmentSettings,
  RoomLiveStatus,
} from "@dailylog/db/queries";
import { formatAge } from "@dailylog/shared";
import { useActionState, useState } from "react";
import {
  addToWaitlistAction,
  closeInquiryAction,
  reEnrollAlumniAction,
  scheduleChildWithdrawalAction,
  sendWaitlistCheckinAction,
  updateWaitlistRulesAction,
  withdrawOfferAction,
  type EnrollmentActionState,
} from "@/lib/enrollment/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

const card = "rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card";

export function AddToWaitlistModal({ enrollment, rooms, waitlist, onClose }: { enrollment: Enrollment; rooms: RoomLiveStatus[]; waitlist: Enrollment[]; onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(addToWaitlistAction, {});
  const [roomId, setRoomId] = useState(enrollment.classroom_id ?? "");
  const [sibling, setSibling] = useState(enrollment.waitlist_priority === "sibling");
  const room = rooms.find((item) => item.id === roomId);
  const active = waitlist.filter((item) => ["active", "offer"].includes(item.waitlist_status));
  const roomWaiting = active.filter((item) => item.classroom_id === roomId).length;
  const expectedPosition = sibling
    ? active.filter((item) => item.waitlist_priority === "sibling").length + 1
    : active.length + 1;
  return (
    <Modal onClose={onClose} width={430}>
      <Heading title="Add to the waitlist" subtitle="Position is computed from the center rules; admins do not hand-sort families." />
      <FamilyPill enrollment={enrollment} />
      {state.ok ? <><Notice tone="success">Added to the ranked waitlist.</Notice><Button type="button" onClick={onClose}>Done</Button></> : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="enrollment_id" value={enrollment.id} />
          <label className="flex flex-col gap-1.5"><span className="text-[13px] font-bold text-ink">Room</span><select name="classroom_id" value={roomId} onChange={(event) => setRoomId(event.target.value)} required className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-3 text-[13px]"><option value="" disabled>Choose room</option>{rooms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <Field label="Desired start" name="desired_start" type="date" defaultValue={enrollment.desired_start_date ?? ""} required />
          <label className={`${card} flex items-center gap-3 px-3.5 py-3`}><span className="flex-1"><b className="block text-[12.5px] text-ink">Sibling already enrolled</b><span className="text-[11px] text-muted">Moves this family into the sibling-priority tier.</span></span><input name="sibling_priority" type="checkbox" checked={sibling} onChange={(event) => setSibling(event.target.checked)} className="size-4 accent-primary" /></label>
          {room && <div className="rounded-[13px] bg-tint px-3.5 py-3 text-[12px] leading-relaxed text-ink"><b>{enrollment.child_first_name ?? "This child"}</b> would join at approximately <b>#{expectedPosition} center-wide</b>; {roomWaiting} {room.name} {roomWaiting === 1 ? "family is" : "families are"} currently ahead for matching spots. {Math.max(0, Number(room.capacity ?? 0) - Number(room.enrolled_count)) > 0 ? "A spot is currently open." : "The room is currently full."}</div>}
          <p className="text-center text-[10.5px] text-faint">The family receives confirmation and can ask the center for their current position.</p>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <Buttons onClose={onClose} pending={pending} submit="Add to waitlist" />
        </form>
      )}
    </Modal>
  );
}

export function WithdrawOfferModal({ enrollment, nextFamily, reviewNext, onClose }: { enrollment: Enrollment; nextFamily?: Enrollment; reviewNext: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(withdrawOfferAction, {});
  return (
    <Modal onClose={onClose} width={430}>
      <Heading title={`Withdraw the ${familyName(enrollment)} offer`} subtitle="This frees the held room spot immediately." />
      {state.ok ? <><Notice tone="success">{reviewNext ? "Offer withdrawn. The released spot and next eligible family are ready for administrator review." : "Offer withdrawn. The room spot remains open for manual follow-up."}</Notice><Button type="button" onClick={onClose}>Done</Button></> : (
        <form action={action} className="flex flex-col gap-4"><input type="hidden" name="enrollment_id" value={enrollment.id} /><label className="flex flex-col gap-1.5"><span className="text-[13px] font-bold text-ink">Reason</span><select name="reason" defaultValue="No response" className="rounded-[13px] border-[1.5px] border-[#D6E1F0] px-3.5 py-3 text-[13px]"><option>No response</option><option>Family went elsewhere</option><option>Start date changed</option><option>Family declined</option></select></label>{nextFamily && <Notice tone="success"><b>Current queue preview:</b> {familyName(nextFamily)} · {nextFamily.child_first_name}. {reviewNext ? "After withdrawal, DailyLog rechecks priority, age, first day and dated capacity before presenting the offer for confirmation." : "Automatic review is off; use Make offer when the spot is ready."}</Notice>}<label className={`${card} flex items-center gap-3 px-3.5 py-3`}><span className="flex-1"><b className="block text-[12.5px] text-ink">Keep this family on the waitlist</b><span className="text-[11px] text-muted">They return to the bottom of the public tier instead of being closed.</span></span><input type="checkbox" name="keep_on_waitlist" defaultChecked className="size-4 accent-primary" /></label><p className="text-center text-[10.5px] leading-relaxed text-faint">Withdrawal, ranking and the family notice commit together. A next-family offer is never sent from this preview.</p>{state.error && <Notice tone="error">{state.error}</Notice>}<Buttons onClose={onClose} pending={pending} submit="Withdraw offer" danger /></form>
      )}
    </Modal>
  );
}

export function WaitlistRulesModal({ settings, onClose }: { settings: EnrollmentSettings; onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(updateWaitlistRulesAction, {});
  return (
    <Modal onClose={onClose} width={430}>
      <Heading title="Waitlist rules" subtitle="These rules drive ranking and automatic offer advancement." />
      {state.ok ? <Notice tone="success">Rules saved and active waitlists re-ranked.</Notice> : null}
      <form action={action} className="flex flex-col gap-3">
        <RuleToggle name="siblings_first" title="Siblings first" detail="Siblings of enrolled children jump ahead of the public tier." defaultChecked={settings.siblings_first} />
        <RuleToggle name="staff_children_next" title="Staff children next" detail="After siblings and before the public list." defaultChecked={settings.staff_children_next} />
        <label className={`${card} flex items-center gap-3 px-3.5 py-3`}><span className="flex-1"><b className="block text-[12.5px] text-ink">Offer window</b><span className="text-[11px] text-muted">How long a family has to accept and pay.</span></span><select name="offer_window_hours" defaultValue={String(settings.offer_window_hours)} className="rounded-full border-[1.5px] border-[#D6E1F0] px-3 py-2 text-[11.5px] font-bold"><option value="48">48 h</option><option value="168">1 week</option><option value="336">2 weeks</option></select></label>
        <RuleToggle name="auto_offer" title="Prepare the next offer review" detail="Declined, expired or withdrawn offers identify the next safe match; an admin confirms before anything is sent." defaultChecked={settings.auto_offer} />
        <label className={`${card} flex items-center gap-3 px-3.5 py-3`}><span className="flex-1"><b className="block text-[12.5px] text-ink">Archive stale entries after</b><span className="text-[11px] text-muted">Unanswered waitlist check-ins.</span></span><input type="number" name="auto_archive_checkins" min={1} max={10} defaultValue={settings.auto_archive_checkins} className="w-16 rounded-[10px] border-[1.5px] border-[#D6E1F0] px-2 py-2 text-center text-[12px] font-bold" /></label>
        <p className="text-center text-[10.5px] leading-relaxed text-faint">Saving re-ranks the active list. Offer and check-in activity remains in the audit trail.</p>
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <Buttons onClose={onClose} pending={pending} submit="Save rules" />
      </form>
    </Modal>
  );
}

export function CloseInquiryModal({ enrollment, onClose }: { enrollment: Enrollment; onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(closeInquiryAction, {});
  const [reason, setReason] = useState("Family chose another program");
  return (
    <Modal onClose={onClose} width={430}>
      <Heading title="Close this inquiry" subtitle="The card leaves the active pipeline; no family information is deleted." />
      <FamilyPill enrollment={enrollment} />
      {state.ok ? <><Notice tone="success">Inquiry closed and kept in history.</Notice><Button type="button" onClick={onClose}>Done</Button></> : (
        <form action={action} className="flex flex-col gap-4"><input type="hidden" name="enrollment_id" value={enrollment.id} /><input type="hidden" name="reason" value={reason} /><fieldset className="flex flex-col gap-2"><legend className="mb-1 text-[13px] font-bold text-ink">Reason</legend>{["Family chose another program", "No spot for their dates", "No response after 3 follow-ups"].map((item) => <button key={item} type="button" onClick={() => setReason(item)} className={`${card} flex items-center gap-3 px-3 py-2.5 text-left text-[12.5px] ${reason === item ? "border-primary bg-tint font-bold text-ink" : "text-muted"}`}><span className={`size-4 rounded-full border-[1.5px] ${reason === item ? "border-primary bg-primary ring-2 ring-white ring-inset" : "border-[#C7D4E5]"}`} />{item}</button>)}</fieldset><RuleToggle name="send_goodbye" title="Send a kind goodbye note" detail="Thanks them and leaves the door open." defaultChecked /><RuleToggle name="keep_on_file" title="Keep on file for future openings" detail="The inquiry can be reopened later." defaultChecked />{state.error && <Notice tone="error">{state.error}</Notice>}<Buttons onClose={onClose} pending={pending} submit="Close inquiry" dark /></form>
      )}
    </Modal>
  );
}

export function WaitlistCheckinModal({ families, settings, onClose }: { families: Enrollment[]; settings: EnrollmentSettings; onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(sendWaitlistCheckinAction, {});
  const [openedAt] = useState(() => Date.now());
  const staleContactCutoff = openedAt - 4 * 30.44 * 86400000;
  const stale = families
    .filter((item) => {
      if (item.waitlist_status !== "active") return false;
      if (item.waitlist_response_due_at && new Date(item.waitlist_response_due_at).getTime() > openedAt) return false;
      if (item.waitlist_unanswered_checkins > 0) return true;
      if (item.waitlist_last_contact_at) {
        return new Date(item.waitlist_last_contact_at).getTime() < staleContactCutoff;
      }
      return Boolean(
        item.waitlist_joined_at &&
          new Date(item.waitlist_joined_at).getTime() < openedAt - 6 * 30.44 * 86400000,
      );
    })
    .sort((a, b) => (a.waitlist_position ?? 999) - (b.waitlist_position ?? 999))
    .slice(0, 6);
  return (
    <Modal onClose={onClose} width={470}>
      <Heading title="Keep the waitlist honest" subtitle="Send a friendly “still interested?” to families whose place may be stale." />
      {state.ok ? <><Notice tone="success">Waitlist check-ins queued.</Notice><Button type="button" onClick={onClose}>Done</Button></> : (
        <form action={action} className="flex flex-col gap-4"><div className="flex max-h-60 flex-col gap-2 overflow-y-auto">{stale.map((family, index) => { const contactReady = Boolean(family.guardian_email && family.offer_code); return <label key={family.id} className={`${card} flex items-center gap-3 px-3 py-2.5 ${contactReady ? "" : "opacity-60"}`}><input type="checkbox" name="enrollment_id" value={family.id} defaultChecked={contactReady && index < 2} disabled={!contactReady} className="size-4 accent-primary" /><span className="flex-1"><b className="block text-[12.5px] text-ink">{familyName(family)} · {family.child_first_name}</b><span className="text-[10.5px] text-muted">#{family.waitlist_position ?? "—"} · {contactReady ? `waiting ${waitDuration(family.waitlist_joined_at ?? family.created_at)}` : "needs a guardian email / secure link"}</span></span><span className={`rounded-full px-2 py-1 text-[9.5px] font-bold ${family.waitlist_unanswered_checkins ? "bg-[#FFF3DD] text-[#A86D13]" : "bg-[#E4F3EC] text-success"}`}>{family.waitlist_unanswered_checkins ? `${family.waitlist_unanswered_checkins} unanswered` : "Due"}</span></label>; })}</div><label className="flex flex-col gap-1.5"><span className="text-[13px] font-bold text-ink">Message <span className="text-danger">*</span></span><textarea name="message" rows={3} required defaultValue="Hi! You're still on our waitlist — please confirm you'd like to keep your spot, or let us know if your plans changed." className="rounded-[13px] border-[1.5px] border-[#D6E1F0] p-3 text-[12.5px]" /></label><div className="rounded-[13px] bg-tint px-3.5 py-3 text-[11.5px] text-ink">Families get 7 days to respond. After <b>{settings.auto_archive_checkins}</b> unanswered windows, the hourly review moves them off the ranked list but never deletes their record.</div>{state.error && <Notice tone="error">{state.error}</Notice>}<Buttons onClose={onClose} pending={pending} submit="Send check-ins" disabled={stale.length === 0} /></form>
      )}
    </Modal>
  );
}

export function WithdrawChildModal({ child, waitlist, onClose }: { child: EnrollmentChildRow; waitlist: Enrollment[]; onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(scheduleChildWithdrawalAction, {});
  const next = waitlist.filter((item) => item.classroom_id === child.classroom?.id && item.waitlist_status === "active").sort((a, b) => (a.waitlist_position ?? 999) - (b.waitlist_position ?? 999))[0];
  const scheduled = child.departure.find((item) => item.status === "scheduled");
  const minimum = new Date(); minimum.setDate(minimum.getDate() + 28);
  return (
    <Modal onClose={onClose} width={450}>
      <Heading title={scheduled ? `Update ${child.first_name}'s withdrawal` : `Withdraw ${child.first_name} from ${child.classroom?.name ?? "the center"}`} subtitle="Schedule the last day and preserve the child's full record in Alumni." />
      {state.ok ? <><Notice tone="success">Withdrawal scheduled. The child stays active through the selected last day.</Notice><Button type="button" onClick={onClose}>Done</Button></> : (
        <form action={action} className="flex flex-col gap-4"><input type="hidden" name="child_id" value={child.id} /><div className="grid grid-cols-2 gap-2.5"><Field label="Last day" name="last_day" type="date" min={new Date().toISOString().slice(0, 10)} defaultValue={scheduled?.last_day ?? minimum.toISOString().slice(0, 10)} required /><label className="flex flex-col gap-1.5"><span className="text-[13px] font-bold text-ink">Reason</span><select name="reason" defaultValue={scheduled?.reason ?? "Family is moving"} className="rounded-[13px] border-[1.5px] border-[#D6E1F0] px-3 py-3.5 text-[13px]"><option>Family is moving</option><option>Graduating</option><option>Program change</option><option>Financial reasons</option><option>Other</option></select></label></div><Field label="Internal note" name="notes" placeholder="Notice received, transition details…" defaultValue={scheduled?.notes ?? ""} /><div className="rounded-[13px] bg-tint px-3.5 py-3 text-[11.5px] leading-relaxed text-ink"><Check>Child remains on the roster through the last day</Check><Check>Daily logs and records remain in Alumni</Check><Check>{next ? `${child.classroom?.name} spot can be reviewed for #${next.waitlist_position} ${familyName(next)}` : `${child.classroom?.name ?? "Room"} spot returns to available capacity`}</Check></div><RuleToggle name="auto_offer_spot" title="Prepare this spot for waitlist review" detail="After the last day, match the next eligible family for an administrator to confirm. Turn off to hold the spot for a transfer or sibling." defaultChecked={scheduled?.offer_spot_automatically ?? true} />{state.error && <Notice tone="error">{state.error}</Notice>}<Buttons onClose={onClose} pending={pending} submit={scheduled ? "Update withdrawal" : "Schedule withdrawal"} danger /></form>
      )}
    </Modal>
  );
}

export function AlumniModal({ alumni, rooms, onClose }: { alumni: EnrollmentChildRow[]; rooms: RoomLiveStatus[]; onClose: () => void }) {
  return (
    <Modal onClose={onClose} width={520}>
      <Heading title="Alumni" subtitle="Withdrawn and graduated children remain available with their profile and history intact." />
      <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto">{alumni.map((child) => <ReEnrollRow key={child.id} child={child} rooms={rooms} />)}{alumni.length === 0 && <p className="rounded-[13px] bg-canvas p-5 text-center text-[12px] text-faint">No alumni yet.</p>}</div>
      <p className="text-center text-[10.5px] leading-relaxed text-faint">Re-enrolling restores the profile and history. A room is required before the child returns to active rosters.</p>
      <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
    </Modal>
  );
}

function ReEnrollRow({ child, rooms }: { child: EnrollmentChildRow; rooms: RoomLiveStatus[] }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(reEnrollAlumniAction, {});
  const departure = child.departure.find((item) => item.status === "completed") ?? child.departure[0];
  return (
    <form action={action} className={`${card} flex flex-col gap-3 p-3.5`}>
      <input type="hidden" name="child_id" value={child.id} />
      <div className="flex items-center gap-3">
        <Avatar name={`${child.first_name} ${child.last_name}`} size={34} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[12.5px] text-ink">{child.last_name} · {child.first_name}</b>
          <span className="block text-[10.5px] text-muted">{departure?.reason ?? "Alumni"}{departure?.last_day ? ` · ${formatDate(departure.last_day)}` : ""}</span>
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[11px] font-bold text-ink">New room <span className="text-danger">*</span></span>
          <select
            name="classroom_id"
            defaultValue=""
            required
            aria-invalid={Boolean(state.error)}
            aria-describedby={state.error ? `reenroll-error-${child.id}` : undefined}
            className={`min-w-0 rounded-[10px] border-[1.5px] bg-card px-2.5 py-2.5 text-[11.5px] ${state.error ? "border-danger" : "border-[#D6E1F0]"}`}
          >
            <option value="" disabled>Choose an eligible room</option>
            {rooms.map((room) => {
              const reason = alumniRoomBlockReason(child, room);
              return <option key={room.id} value={room.id} disabled={Boolean(reason)}>{room.name}{reason ? ` — ${reason}` : ` — ${room.enrolled_count}/${room.capacity}`}</option>;
            })}
          </select>
        </label>
        <button type="submit" disabled={pending || state.ok} className="rounded-full bg-primary px-4 py-2.5 text-[11.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-50">{pending ? "Restoring…" : "Re-enroll"}</button>
      </div>
      {state.error && <span id={`reenroll-error-${child.id}`} role="alert" className="text-[10.5px] leading-relaxed text-danger">{state.error}</span>}
      {state.ok && <span className="text-[10.5px] font-bold text-success">Profile and enrollment restored ✓</span>}
    </form>
  );
}

function alumniRoomBlockReason(child: EnrollmentChildRow, room: RoomLiveStatus): string | null {
  if (Number(room.capacity) < 1) return "capacity not set";
  if (Number(room.enrolled_count) >= Number(room.capacity)) return "full";
  if (!child.date_of_birth) return "birth date needed";
  const birthday = new Date(`${child.date_of_birth}T12:00:00`);
  const today = new Date();
  let ageMonths = (today.getFullYear() - birthday.getFullYear()) * 12 + today.getMonth() - birthday.getMonth();
  if (today.getDate() < birthday.getDate()) ageMonths -= 1;
  if (ageMonths < Number(room.min_age_months) || ageMonths >= Number(room.max_age_months)) return "age does not fit";
  if (room.opens_on && room.opens_on > today.toISOString().slice(0, 10)) return "not open yet";
  return null;
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) { return <div><h2 className="text-[19px] font-extrabold text-ink">{title}</h2><p className="mt-0.5 text-[12.5px] leading-normal text-muted">{subtitle}</p></div>; }
function FamilyPill({ enrollment }: { enrollment: Enrollment }) { return <div className="flex w-fit items-center gap-2 rounded-full bg-canvas py-1.5 pl-1.5 pr-3.5"><Avatar name={enrollment.guardian_name ?? "Family"} size={30} /><b className="text-[12.5px] text-ink">{familyName(enrollment)} · {enrollment.child_first_name ?? "Child"}{enrollment.child_date_of_birth ? ` · ${formatAge(enrollment.child_date_of_birth)}` : ""}</b></div>; }
function RuleToggle({ name, title, detail, defaultChecked = false }: { name: string; title: string; detail: string; defaultChecked?: boolean }) { return <label className={`${card} flex items-center gap-3 px-3.5 py-3`}><span className="flex-1"><b className="block text-[12.5px] text-ink">{title}</b><span className="text-[11px] text-muted">{detail}</span></span><input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-primary" /></label>; }
function Buttons({ onClose, pending, submit, danger = false, dark = false, disabled = false }: { onClose: () => void; pending: boolean; submit: string; danger?: boolean; dark?: boolean; disabled?: boolean }) { return <div className="flex gap-2.5"><Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>Cancel</Button><button type="submit" disabled={pending || disabled} className={`flex-1 rounded-full py-3 text-sm font-bold text-white disabled:opacity-50 ${danger ? "bg-danger" : dark ? "bg-ink" : "bg-primary"}`}>{pending ? "Saving…" : submit}</button></div>; }
function Check({ children }: { children: React.ReactNode }) { return <span className="flex gap-2 py-1"><b className="text-success">✓</b>{children}</span>; }
function familyName(enrollment: Enrollment): string { return enrollment.guardian_name?.split(" ").slice(-1)[0] ?? "Family"; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function waitDuration(value: string | null): string { if (!value) return "unknown"; const months = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 2629800000)); return months < 1 ? "under a month" : `${months} month${months === 1 ? "" : "s"}`; }
