"use client";

import type {
  Enrollment,
  EnrollmentTourSlotRow,
  RoomVacancyReview,
  RoomLiveStatus,
} from "@dailylog/db/queries";
import { formatAge } from "@dailylog/shared";
import { useActionState, useState } from "react";
import {
  bookTourAction,
  cancelTourSlotAction,
  createTourSlotAction,
  logTourOutcomeAction,
  nudgeOfferAction,
  requestDocumentsAction,
  saveEnrollmentOnboardingAction,
  sendOfferAction,
  type EnrollmentActionState,
} from "@/lib/enrollment/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

const card = "rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card";

export function TourSlotsModal({
  slots,
  classrooms,
  educators,
  timeZone,
  onClose,
}: {
  slots: EnrollmentTourSlotRow[];
  classrooms: { id: string; name: string }[];
  educators: { id: string; fullName: string }[];
  timeZone: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(createTourSlotAction, {});
  const upcoming = slots.filter((slot) => new Date(slot.starts_at) >= new Date()).slice(0, 8);
  return (
    <Modal onClose={onClose} width={520}>
      <ModalHeading title="Tour slots" subtitle="Families can book open times from the inquiry auto-reply. Booked slots keep their family and host together." />
      <div className="flex flex-col gap-2">
        {upcoming.map((slot) => (
          <div key={slot.id} className={`${card} flex items-center gap-3 px-3.5 py-3`}>
            <span className="min-w-0 flex-1">
              <b className="block text-[12.5px] text-ink">{formatDateTime(slot.starts_at)}</b>
              <span className="block text-[11px] text-muted">
                {slot.status === "booked" ? `${familyLabel(slot.enrollment)} · ` : "Open · "}
                {slot.classroom?.name ?? "any program"} · {slot.host?.full_name ?? "no host yet"}
              </span>
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${slot.status === "booked" ? "bg-tint text-primary" : "bg-[#E4F3EC] text-success"}`}>
              {slot.status === "booked" ? "Booked" : "Open"}
            </span>
            {slot.status === "open" && (
              <form action={cancelTourSlotAction}>
                <input type="hidden" name="slot_id" value={slot.id} />
                <button type="submit" className="text-[11px] font-bold text-danger hover:underline">Remove</button>
              </form>
            )}
          </div>
        ))}
        {upcoming.length === 0 && <p className="rounded-[13px] bg-canvas px-3 py-4 text-center text-[11.5px] text-faint">No upcoming tour slots.</p>}
      </div>
      <form action={action} className="flex flex-col gap-3 rounded-[14px] bg-canvas p-3.5">
        <input type="hidden" name="time_zone" value={timeZone} />
        <b className="text-[12.5px] text-ink">Add a 45-minute slot</b>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Date" name="date" type="date" min={new Date().toISOString().slice(0, 10)} required />
          <Field label="Time" name="time" type="time" required />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Select label="Program" name="classroom_id" options={classrooms} empty="Any program" />
          <Select label="Host" name="host_id" options={educators.map((item) => ({ id: item.id, name: item.fullName }))} empty="Assign later" />
        </div>
        {state.ok && <Notice tone="success">Tour slot added.</Notice>}
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <Button type="submit" disabled={pending} className="py-2.5 text-sm">{pending ? "Adding…" : "+ Add a slot"}</Button>
      </form>
      <ToggleSummary title="Families can self-book" detail="Confirmation sends immediately; the booked host sees the family on this calendar." />
      <Button type="button" variant="secondary" className="py-3 text-sm" onClick={onClose}>Done</Button>
    </Modal>
  );
}

export function BookTourModal({
  enrollment,
  slots,
  educators,
  onClose,
}: {
  enrollment: Enrollment;
  slots: EnrollmentTourSlotRow[];
  educators: { id: string; fullName: string }[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(bookTourAction, {});
  const open = slots.filter((slot) => slot.status === "open" && new Date(slot.starts_at) > new Date());
  return (
    <Modal onClose={onClose} width={430}>
      <ModalHeading title="Book a tour" subtitle="For families who call instead of choosing a slot from their email." />
      <FamilyPill enrollment={enrollment} />
      {state.ok ? (
        <><Notice tone="success"><b>Tour booked.</b> The family card is now in Tour booked.</Notice><Button type="button" onClick={onClose}>Done</Button></>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="enrollment_id" value={enrollment.id} />
          <Select label="Pick a slot" name="slot_id" options={open.map((slot) => ({ id: slot.id, name: `${formatDateTime(slot.starts_at)} · ${slot.classroom?.name ?? "Any program"}` }))} empty="Choose an open time" required />
          <Select label="Host" name="host_id" options={educators.map((item) => ({ id: item.id, name: item.fullName }))} empty="Assign later" />
          <ToggleSummary title="Send confirmation + reminder" detail="Email now, then a reminder the evening before." />
          {open.length === 0 && <div className="rounded-[13px] border border-[#EFCF94] bg-[#FFF8EA] px-3.5 py-3 text-[12px] text-ink">Create an open tour slot first.</div>}
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <ModalButtons onClose={onClose} pending={pending} submit="Book tour" disabled={open.length === 0} />
        </form>
      )}
    </Modal>
  );
}

export function ApplicationDetailModal({
  enrollment,
  rooms,
  educators,
  onRequestDocuments,
  onSendOffer,
  onLogTour,
  onPreviewForm,
  onClose,
}: {
  enrollment: Enrollment;
  rooms: RoomLiveStatus[];
  educators: { id: string; fullName: string }[];
  onRequestDocuments: () => void;
  onSendOffer: () => void;
  onLogTour: () => void;
  onPreviewForm: () => void;
  onClose: () => void;
}) {
  const room = rooms.find((item) => item.id === enrollment.classroom_id);
  const schedule = jsonObject(enrollment.schedule);
  const application = jsonObject(enrollment.application_data);
  const docs = documentRows(enrollment.documents_status);
  const received = docs.filter((item) => item.status === "received").length;
  const tuition = enrollment.offer_tuition_cents ?? Number(application.tuition_cents ?? 118000);
  return (
    <Modal onClose={onClose} width={790}>
      <div className="flex items-start gap-3">
        <Avatar name={enrollment.guardian_name ?? "Family"} size={42} />
        <span className="min-w-0 flex-1">
          <h2 className="text-[19px] font-extrabold text-ink">{familyName(enrollment)} family</h2>
          <p className="text-[12px] text-muted">{enrollment.child_first_name ?? "Child"}{enrollment.child_date_of_birth ? ` · ${formatAge(enrollment.child_date_of_birth)}` : ""} · applying for {room?.name ?? "a program"}{enrollment.desired_start_date ? ` · wants ${formatDate(enrollment.desired_start_date)}` : ""}</p>
        </span>
        <Button type="button" variant="secondary" className="px-4 py-2 text-xs" onClick={onPreviewForm}>Family view</Button>
        <Button type="button" variant="secondary" className="px-4 py-2 text-xs" onClick={onLogTour}>Tour outcome</Button>
        <Button type="button" className="px-4 py-2 text-xs" onClick={onSendOffer}>Send offer</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.35fr_.9fr]">
        <div className="flex flex-col gap-4">
          <section className={`${card} p-4`}>
            <h3 className="text-[13px] font-extrabold text-ink">Application</h3>
            <div className="mt-3 grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-[11.5px]">
              <Label>PRIMARY</Label><span>{enrollment.guardian_name ?? "—"} · {enrollment.guardian_phone ?? "no phone"} · {enrollment.guardian_email ?? "no email"}</span>
              <Label>SCHEDULE</Label><span>{String(schedule.days ?? "Mon–Fri")} · {String(schedule.day_length ?? "full day")} · {String(schedule.dropoff ?? "7:30")} drop-off · {String(schedule.pickup ?? "5:30")} pickup</span>
              <Label>START</Label><span>{enrollment.desired_start_date ? formatDate(enrollment.desired_start_date) : "Flexible"} · {room?.name ?? "Program open"}</span>
            </div>
            {application.allergy || application.allergies ? <div className="mt-3 rounded-[13px] border border-[#EFCF94] bg-[#FFF8EA] px-3.5 py-3 text-[12px] text-ink"><b>{String(application.allergy ?? application.allergies)}</b> noted on the application — carry this into the child profile if enrolled.</div> : null}
          </section>
          <section className={`${card} p-4`}>
            <div className="flex items-center gap-2"><h3 className="text-[13px] font-extrabold text-ink">Documents</h3><span className="text-[11px] text-faint">{received} of {docs.length} received</span><button type="button" onClick={onRequestDocuments} className="ml-auto text-[11.5px] font-bold text-primary hover:underline">Request missing</button></div>
            <div className="mt-2 divide-y divide-[#EDF3FB]">
              {docs.map((document) => <div key={document.key} className="flex items-center gap-2 py-2 text-[11.5px]"><span className={`size-2 rounded-full ${document.status === "received" ? "bg-success" : document.status === "requested" ? "bg-[#B0782B]" : "bg-[#C7D4E5]"}`} /><span className="flex-1 text-ink">{document.label}</span><span className="capitalize text-faint">{document.status}</span></div>)}
            </div>
          </section>
          <section className={`${card} p-4`}>
            <h3 className="text-[13px] font-extrabold text-ink">Notes &amp; activity</h3>
            <p className="mt-2 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">{enrollment.tour_notes || enrollment.notes || "Inquiry received and welcome response sent."}</p>
            {enrollment.tour_at && <p className="mt-2 text-[11px] text-faint">Tour {formatDateTime(enrollment.tour_at)} · host {educators.find((item) => item.id === enrollment.tour_host_id)?.fullName ?? "not assigned"}</p>}
          </section>
        </div>
        <aside className="flex flex-col gap-4">
          <section className="rounded-[14px] border-[1.5px] border-[#CBE7D8] bg-[#F5FBF8] p-4">
            <h3 className="text-[13px] font-extrabold text-ink">Fit check</h3>
            <CheckLine>{room ? `${Math.max(0, Number(room.capacity ?? 0) - Number(room.enrolled_count))} spots available in ${room.name}` : "Choose a destination room"}</CheckLine>
            <CheckLine>{enrollment.child_date_of_birth ? `Age ${formatAge(enrollment.child_date_of_birth)} fits the selected program` : "Birthday needed to confirm age fit"}</CheckLine>
            <CheckLine>Capacity and live ratio data are checked from Rooms &amp; ratios</CheckLine>
          </section>
          <section className={`${card} p-4`}>
            <h3 className="text-[13px] font-extrabold text-ink">Tuition estimate</h3>
            <b className="mt-3 block text-[18px] text-ink">{money(tuition)} <span className="text-[11px] font-normal text-muted">/ month</span></b>
            <p className="mt-1 text-[11.5px] text-muted">Deposit at acceptance · {money(enrollment.offer_deposit_cents ?? 50000)}</p>
            <p className="mt-3 text-[10.5px] leading-relaxed text-faint">The offer email includes this estimate and the deposit amount.</p>
          </section>
          <section className={`${card} p-4`}>
            <h3 className="text-[13px] font-extrabold text-ink">Application progress</h3>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#EDF3FB]"><span className="block h-full rounded-full bg-primary" style={{ width: `${enrollment.application_progress}%` }} /></div>
            <p className="mt-1 text-[11px] text-faint">{enrollment.application_progress}% complete · saves as the family goes</p>
          </section>
        </aside>
      </div>
      <Button type="button" variant="secondary" className="py-3 text-sm" onClick={onClose}>Close application</Button>
    </Modal>
  );
}

export function FamilyApplicationPreviewModal({ enrollment, onClose }: { enrollment: Enrollment; onClose: () => void }) {
  const application = jsonObject(enrollment.application_data);
  const currentStep = Math.max(1, Math.min(5, Math.ceil(enrollment.application_progress / 20)));
  const steps = ["Family & contacts", "Schedule & start date", "Health & allergies", "Documents", "Review & sign"];
  return (
    <Modal onClose={onClose} width={390}>
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-full bg-[#FBF3E4]"><span className="size-4 rounded-full bg-[#F0B441] ring-[3px] ring-[#F8DFA6]" /></span>
        <span><h2 className="text-[17px] font-extrabold text-ink">{enrollment.child_first_name ?? "Family"}&apos;s application</h2><p className="text-[11.5px] text-muted">Sunny Grove · saves as the family goes</p></span>
      </div>
      <div className="flex items-center gap-2"><span className="h-2 flex-1 overflow-hidden rounded-full bg-[#EDF3FB]"><span className="block h-full rounded-full bg-primary" style={{ width: `${enrollment.application_progress}%` }} /></span><b className="text-[11px] text-muted">{currentStep} of 5</b></div>
      <div className="flex flex-col">
        {steps.map((step, index) => {
          const complete = index + 1 < currentStep;
          const current = index + 1 === currentStep;
          return <div key={step} className="flex items-center gap-2.5 border-b border-[#EDF3FB] py-2.5 last:border-0"><span className={`grid size-3.5 place-items-center rounded-full text-[9px] ${complete ? "bg-success text-white" : current ? "bg-primary" : "border-[1.5px] border-[#D6E1F0]"}`}>{complete ? "✓" : ""}</span><span className={`text-[12px] ${current ? "font-bold text-ink" : "text-faint"}`}>{step}</span>{current && <span className="ml-auto rounded-full bg-tint px-2 py-0.5 text-[9.5px] font-bold text-primary">now</span>}</div>;
        })}
      </div>
      <div className="flex flex-col gap-1.5"><b className="text-[12.5px] text-ink">Allergies or medical needs</b><div className={`${card} px-3.5 py-3 text-[12.5px] leading-relaxed text-ink`}>{String(application.allergy ?? application.allergies ?? "None entered yet")}</div></div>
      <div className="flex flex-col gap-1.5"><b className="text-[12.5px] text-ink">Doctor &amp; clinic</b><div className={`${card} px-3.5 py-3 text-[12.5px] text-faint`}>{String(application.doctor ?? "Name and phone")}</div></div>
      <Button type="button" className="py-3 text-sm" onClick={onClose}>Close family preview</Button>
      <p className="text-center text-[10.5px] leading-relaxed text-faint">Preview only — the family completes this from the secure application link.</p>
    </Modal>
  );
}

export function EnrollmentLifecycleModal({
  enrollment,
  educators,
  centerToday,
  onClose,
}: {
  enrollment: Enrollment;
  educators: { id: string; fullName: string; classroomId: string | null }[];
  centerToday: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(
    saveEnrollmentOnboardingAction,
    {},
  );
  const steps = jsonObject(enrollment.onboarding_steps);
  const roomSchedule = jsonObject(steps.room_schedule);
  const primaryEducatorId = String(
    roomSchedule.primary_educator_id ?? steps.primary_educator_id ?? "",
  );
  const primaryEducatorName = String(
    roomSchedule.primary_educator_name ?? steps.primary_educator_name ?? "",
  );
  const cubbyLabel = String(roomSchedule.cubby_label ?? steps.cubby_label ?? "");
  const billingStatus = String(steps.billing_status ?? "pending");
  const billingAmount = Number(steps.billing_amount_cents ?? enrollment.offer_tuition_cents ?? 0);
  const eligibleEducators = educators.filter(
    (educator) => educator.classroomId === enrollment.classroom_id,
  );
  const documents = documentRows(enrollment.documents_status);
  const accepted = enrollment.offer_status === "accepted" || enrollment.stage === "enrolled";
  const depositPaid = (enrollment.offer_deposit_cents ?? 0) === 0
    || enrollment.deposit_status === "paid";
  const roomReady = Boolean(primaryEducatorId && cubbyLabel);
  const firstDayStarted = Boolean(
    enrollment.stage === "enrolled"
    && enrollment.child_id
    && enrollment.desired_start_date
    && enrollment.desired_start_date <= centerToday,
  );
  const complete = [
    Boolean(enrollment.offer_sent_at && accepted),
    accepted && depositPaid,
    documents.every((item) => item.status === "received"),
    roomReady || state.ok === true,
    firstDayStarted,
  ];
  const scheduleLabel = String(roomSchedule.schedule_label ?? (
    Object.keys(jsonObject(enrollment.schedule)).length > 0
      ? "Family schedule saved"
      : "Schedule not entered"
  ));
  const details = [
    enrollment.offer_sent_at
      ? `${accepted ? "Accepted" : "Sent"} · ${formatDateTime(enrollment.offer_sent_at)}`
      : "Send an offer before onboarding",
    accepted
      ? depositPaid
        ? `${money(enrollment.offer_deposit_cents ?? 0)} paid and credited`
        : `${money(enrollment.offer_deposit_cents ?? 0)} deposit still due`
      : "Waiting for family acceptance",
    `${documents.filter((item) => item.status === "received").length} of ${documents.length} documents received`,
    roomReady
      ? `${primaryEducatorName || "Educator assigned"} · cubby ${cubbyLabel} · ${scheduleLabel}`
      : "Assign a primary educator and cubby before the first day",
    enrollment.desired_start_date
      ? firstDayStarted
        ? `${formatDate(enrollment.desired_start_date)} · educator roster and check-in active · ${billingStatus === "no_charge" ? "no tuition charge" : `${money(billingAmount)} monthly tuition active`}`
        : `${formatDate(enrollment.desired_start_date)} · educator roster, check-in and ${billingStatus === "no_charge" ? "no-charge billing status" : `${money(billingAmount)} monthly tuition`} activate that day`
      : "Choose a first day",
  ];
  return (
    <Modal onClose={onClose} width={620}>
      <div className="flex items-center gap-3"><Avatar name={enrollment.child_first_name ?? "Child"} size={40} /><span className="flex-1"><h2 className="text-[19px] font-extrabold text-ink">{familyName(enrollment)} · {enrollment.child_first_name}</h2><p className="text-[12px] text-muted">Offer to first day · {complete.filter(Boolean).length} of 5 complete</p></span><span className="rounded-full bg-tint px-3 py-1 text-[11px] font-bold text-primary">Onboarding</span></div>
      <div className="flex flex-col">
        {["Offer sent & accepted", "Deposit paid", "Paperwork complete", "Room & schedule", "First day"].map((title, index) => (
          <div key={title} className="flex gap-3 border-b border-[#EDF3FB] py-3 last:border-0"><span className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${complete[index] ? "bg-[#E4F3EC] text-success" : "bg-tint text-primary"}`}>{complete[index] ? "✓" : index + 1}</span><span><b className="block text-[12.5px] text-ink">{title}</b><span className="text-[11.5px] text-muted">{details[index]}</span></span></div>
        ))}
      </div>
      {enrollment.stage === "enrolled" && !state.ok && (
        <form action={action} className="flex flex-col gap-3 rounded-[14px] bg-canvas p-3.5">
          <input type="hidden" name="enrollment_id" value={enrollment.id} />
          <b className="text-[12.5px] text-ink">Room handoff</b>
          <div className="grid grid-cols-2 gap-2.5">
            <div className={state.fieldErrors?.primary_educator_id ? "rounded-[14px] ring-2 ring-danger" : ""}>
              <Select
                label="Primary educator"
                name="primary_educator_id"
                options={eligibleEducators.map((item) => ({ id: item.id, name: item.fullName }))}
                empty="Choose an educator"
                defaultValue={primaryEducatorId}
                required
              />
            </div>
            <Field
              label="Cubby label"
              name="cubby_label"
              maxLength={30}
              defaultValue={cubbyLabel}
              placeholder="e.g. C-12"
              required
              aria-invalid={Boolean(state.fieldErrors?.cubby_label)}
              className={state.fieldErrors?.cubby_label ? "border-danger ring-1 ring-danger" : ""}
            />
          </div>
          {eligibleEducators.length === 0 && (
            <Notice tone="error">Assign an active educator to this room from Staff before completing the handoff.</Notice>
          )}
          <label className="flex items-start gap-2.5 text-[11.5px] leading-relaxed text-muted">
            <input type="checkbox" name="send_welcome" defaultChecked className="mt-0.5 size-4 accent-primary" />
            Schedule the family welcome for three days before the first day. If that date has passed, send it now.
          </label>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <Button type="submit" disabled={pending || eligibleEducators.length === 0} className="py-2.5 text-sm">
            {pending ? "Saving handoff…" : roomReady ? "Update room handoff" : "Complete room handoff"}
          </Button>
        </form>
      )}
      {state.ok && <Notice tone="success">Room handoff saved. The family welcome is scheduled, and educator access will begin on the first day.</Notice>}
      {enrollment.stage !== "enrolled" && <Notice tone="info">Finish the accepted enrollment before assigning the cubby and primary educator.</Notice>}
      <Notice tone="info">The accepted spot counts toward future capacity now. Educator rosters and attendance remain hidden until the first day.</Notice>
      <Button type="button" variant="secondary" onClick={onClose}>{state.ok ? "Done" : "Close"}</Button>
    </Modal>
  );
}

export function RequestDocumentsModal({ enrollment, onClose }: { enrollment: Enrollment; onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(requestDocumentsAction, {});
  const missing = documentRows(enrollment.documents_status).filter((item) => item.status !== "received");
  const requestable = missing.filter((item) => item.key !== "handbook" || Boolean(enrollment.child_id));
  const firstRequestable = requestable.find((item) => item.status !== "requested")?.key;
  return (
    <Modal onClose={onClose} width={430}>
      <ModalHeading title="Request documents" subtitle="The family uploads from their application; statuses return to the application detail." />
      <FamilyPill enrollment={enrollment} />
      {state.ok ? <><Notice tone="success">Document request queued for delivery.</Notice><Button type="button" onClick={onClose}>Done</Button></> : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="enrollment_id" value={enrollment.id} />
          <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-[13px] font-bold text-ink">Still missing</legend>{missing.map((document) => { const available = document.key !== "handbook" || Boolean(enrollment.child_id); return <label key={document.key} className={`${card} flex items-center gap-3 px-3 py-2.5 ${available ? "" : "opacity-70"}`}><input type="checkbox" name="documents" value={document.key} disabled={!available} defaultChecked={document.key === firstRequestable} className="size-4 accent-primary" /><span className="flex-1"><b className="block text-[12px] text-ink">{document.label}</b><span className="text-[10.5px] text-faint">{!available ? "Completed when the family signs an offer" : document.status === "requested" ? `Requested${document.requestedAt ? ` ${formatDateTime(document.requestedAt)}` : ""}` : "Required before the first day"}</span></span></label>; })}</fieldset>
          <label className="flex flex-col gap-1.5"><span className="text-[13px] font-bold text-ink">Message</span><textarea name="message" rows={3} required maxLength={2000} defaultValue={`Hi ${enrollment.guardian_name?.split(" ")[0] ?? "there"} — one last thing before ${enrollment.child_first_name ?? "your child's"} start date. Please upload the missing form from your application. Thank you!`} className="rounded-[13px] border-[1.5px] border-[#D6E1F0] p-3 text-[12.5px] text-ink outline-none focus:border-primary" /></label>
          <p className="text-center text-[10.5px] text-faint">The request is queued by email and remains marked Requested until received.</p>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <ModalButtons onClose={onClose} pending={pending} submit="Send request" disabled={requestable.length === 0} />
        </form>
      )}
    </Modal>
  );
}

export function SendOfferModal({ enrollment, rooms, defaultWindow, onClose }: { enrollment: Enrollment; rooms: RoomLiveStatus[]; defaultWindow: number; onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(sendOfferAction, {});
  const room = rooms.find((item) => item.id === enrollment.classroom_id);
  return (
    <Modal onClose={onClose} width={430}>
      <ModalHeading title="Send a waitlist offer" subtitle="The family receives an email with the room, first day, tuition, deadline and deposit." />
      <FamilyPill enrollment={enrollment} detail={enrollment.waitlist_position ? `#${enrollment.waitlist_position} on the waitlist` : undefined} />
      {state.ok ? <><Notice tone="success"><b>Offer sent.</b> The spot is now held until the deadline.</Notice><Button type="button" onClick={onClose}>Done</Button></> : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="enrollment_id" value={enrollment.id} />
          <Select label="The room" name="classroom_id" defaultValue={room?.id ?? ""} options={rooms.map((item) => ({ id: item.id, name: `${item.name} · ${item.enrolled_count}/${item.capacity ?? "—"} currently enrolled` }))} empty="Choose room" required />
          <div className="grid grid-cols-2 gap-2.5"><Field label="First day" name="desired_start" type="date" defaultValue={enrollment.desired_start_date ?? ""} required /><Select label="Offer expires" name="offer_window_hours" defaultValue={String(defaultWindow)} options={[{ id: "48", name: "48 hours" }, { id: "168", name: "1 week" }, { id: "336", name: "2 weeks" }]} required /></div>
          <div className="grid grid-cols-2 gap-2.5"><Field label="Tuition / month" name="tuition" type="number" min={0} defaultValue={(enrollment.offer_tuition_cents ?? 145000) / 100} required /><Field label="Deposit" name="deposit" type="number" min={0} defaultValue={(enrollment.offer_deposit_cents ?? 20000) / 100} required /></div>
          <Notice tone="info">Room capacity, age fit, center closures and the selected first day are rechecked atomically when you send. Published staffing gaps remain visible in the application fit check so coverage can be planned before arrival.</Notice>
          <Notice tone="success">The deposit is credited to the first month. If this offer closes, the configured rule can prepare the next safe family for administrator review.</Notice>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <ModalButtons onClose={onClose} pending={pending} submit="Send offer" />
        </form>
      )}
    </Modal>
  );
}

export function RoomVacancyReviewModal({
  review,
  defaultWindow,
  onClose,
}: {
  review: RoomVacancyReview;
  defaultWindow: number;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(sendOfferAction, {});
  const childName = [review.candidate_child_first_name, review.candidate_child_last_name]
    .filter(Boolean)
    .join(" ");
  const familyName = review.candidate_guardian_name?.split(" ").slice(-1)[0] ?? "Family";
  const spotsBeforeOffer = Math.max(
    0,
    Number(review.capacity ?? 0) - Number(review.projected_children ?? 0),
  );

  return (
    <Modal onClose={onClose} width={450}>
      <ModalHeading
        title={`Review the ${review.room_name} opening`}
        subtitle={`${review.moved_child_name}'s completed move released this spot. Rechecked live before the offer is sent.`}
      />
      {state.ok ? (
        <>
          <Notice tone="success"><b>Offer sent.</b> The released spot is held for this family until the deadline.</Notice>
          <Button type="button" onClick={onClose}>Done</Button>
        </>
      ) : review.candidate_enrollment_id && review.candidate_offer_start_on ? (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="enrollment_id" value={review.candidate_enrollment_id} />
          <input type="hidden" name="classroom_id" value={review.classroom_id} />
          <input type="hidden" name="desired_start" value={review.candidate_offer_start_on} />
          <input type="hidden" name="vacancy_review_id" value={review.id} />
          <input type="hidden" name="expected_vacancy_updated_at" value={review.updated_at} />

          <div className="flex items-center gap-3 rounded-full border-[1.5px] border-[#D6E1F0] bg-canvas py-2 pl-2 pr-4">
            <Avatar name={review.candidate_guardian_name ?? childName} size={34} />
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[13px] text-ink">{familyName} · {childName || "Child"}</b>
              <span className="block text-[10.5px] text-muted">
                #{review.candidate_waitlist_position ?? "—"} on the {review.room_name} waitlist
                {review.candidate_waitlist_priority && review.candidate_waitlist_priority !== "public"
                  ? ` · ${review.candidate_waitlist_priority} priority`
                  : ""}
              </span>
            </span>
          </div>

          <div className={`${card} divide-y divide-[#EDF3FB] px-4`}>
            <ReviewCheck label="Capacity" value={`${spotsBeforeOffer} ${spotsBeforeOffer === 1 ? "spot" : "spots"} available · ${review.projected_children ?? 0}/${review.capacity ?? "—"} projected`} />
            <ReviewCheck label="Age fit" value={`${review.candidate_age_months ?? "—"} months · fits ${review.room_name}`} />
            <ReviewCheck label="First day" value={formatDate(review.candidate_offer_start_on)} />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Field
              label="Tuition / month"
              name="tuition"
              type="number"
              min={0}
              defaultValue={(review.candidate_offer_tuition_cents ?? 145000) / 100}
              required
            />
            <Field
              label="Deposit"
              name="deposit"
              type="number"
              min={0}
              defaultValue={(review.candidate_offer_deposit_cents ?? 20000) / 100}
              required
            />
          </div>
          <Select
            label="Offer expires"
            name="offer_window_hours"
            defaultValue={String(defaultWindow)}
            options={[
              { id: "48", name: "48 hours" },
              { id: "168", name: "1 week" },
              { id: "336", name: "2 weeks" },
            ]}
            required
          />
          <Notice tone="success">No message has gone out yet. Confirming creates one offer, holds one spot, and opens the existing secure parent enrollment flow.</Notice>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <ModalButtons onClose={onClose} pending={pending} submit="Confirm & send offer" />
        </form>
      ) : (
        <>
          <Notice tone="error">{review.blocking_reason ?? "No eligible family is available right now."}</Notice>
          <p className="text-[11.5px] leading-relaxed text-muted">The released spot stays in the review queue and is matched again whenever Enrollment is opened.</p>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </>
      )}
    </Modal>
  );
}

export function OfferNudgeModal({ enrollment, onClose }: { enrollment: Enrollment; onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(nudgeOfferAction, {});
  return (
    <Modal onClose={onClose} width={430}>
      <ModalHeading title="Nudge an open offer" subtitle={`${enrollment.child_first_name ?? "This"} offer ${enrollment.offer_expires_at ? `expires ${formatDateTime(enrollment.offer_expires_at)}` : "is still open"}.`} />
      <FamilyPill enrollment={enrollment} detail={enrollment.offer_viewed_at ? "Offer viewed · deposit not recorded" : "Offer not viewed yet"} />
      {state.ok ? <><Notice tone="success">Friendly reminder queued.</Notice><Button type="button" onClick={onClose}>Done</Button></> : (
        <form action={action} className="flex flex-col gap-4"><input type="hidden" name="enrollment_id" value={enrollment.id} /><label className="flex flex-col gap-1.5"><span className="text-[13px] font-bold text-ink">Message</span><textarea name="message" rows={4} defaultValue={`Hi ${enrollment.guardian_name?.split(" ")[0] ?? "there"} — just a reminder that ${enrollment.child_first_name ?? "your child's"} spot is being held. Open the offer to accept, or reply if you need more time.`} className="rounded-[13px] border-[1.5px] border-[#D6E1F0] p-3 text-[12.5px]" /></label><label className="flex items-center gap-3 rounded-[13px] bg-canvas p-3"><span className="flex-1"><b className="block text-[12.5px] text-ink">Extend the offer 48 hours</b><span className="text-[11px] text-muted">Use this instead of creating another offer.</span></span><input type="checkbox" name="extend_offer" className="size-4 accent-primary" /></label><p className="text-center text-[10.5px] text-faint">One friendly reminder per offer unless you explicitly extend it.</p>{state.error && <Notice tone="error">{state.error}</Notice>}<ModalButtons onClose={onClose} pending={pending} submit="Send nudge" /></form>
      )}
    </Modal>
  );
}

export function TourOutcomeModal({ enrollment, onClose }: { enrollment: Enrollment; onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(logTourOutcomeAction, {});
  const [outcome, setOutcome] = useState(enrollment.tour_outcome ?? "attended");
  return (
    <Modal onClose={onClose} width={430}>
      <ModalHeading title="How did the tour go?" subtitle="Logging the outcome moves an attended family into the application stage." />
      <FamilyPill enrollment={enrollment} detail={enrollment.tour_at ? formatDateTime(enrollment.tour_at) : "Tour date not set"} />
      {state.ok ? <><Notice tone="success">Tour outcome saved.</Notice><Button type="button" onClick={onClose}>Done</Button></> : (
        <form action={action} className="flex flex-col gap-4"><input type="hidden" name="enrollment_id" value={enrollment.id} /><input type="hidden" name="outcome" value={outcome} /><div className="flex gap-2">{[{ id: "attended", label: "Attended" }, { id: "no_show", label: "No-show" }, { id: "rescheduled", label: "Rescheduled" }].map((item) => <button key={item.id} type="button" onClick={() => setOutcome(item.id)} className={`flex-1 rounded-full border-[1.5px] px-2 py-2 text-[11.5px] font-bold ${outcome === item.id ? "border-primary bg-primary text-white" : "border-[#D6E1F0] text-muted"}`}>{item.label}</button>)}</div><label className="flex flex-col gap-1.5"><span className="text-[13px] font-bold text-ink">Notes</span><textarea name="notes" rows={4} defaultValue={enrollment.tour_notes ?? ""} placeholder="What did the family like or ask about?" className="rounded-[13px] border-[1.5px] border-[#D6E1F0] p-3 text-[12.5px]" /></label>{outcome === "attended" && <label className="flex items-center gap-3 rounded-[13px] bg-canvas p-3"><span className="flex-1"><b className="block text-[12.5px] text-ink">Send the application now</b><span className="text-[11px] text-muted">The family completes it from their link.</span></span><input type="checkbox" name="send_application" defaultChecked className="size-4 accent-primary" /></label>}{state.error && <Notice tone="error">{state.error}</Notice>}<ModalButtons onClose={onClose} pending={pending} submit={outcome === "attended" ? "Save & send application" : "Save outcome"} /></form>
      )}
    </Modal>
  );
}

export function OfferPreviewModal({ enrollment, roomName, onClose }: { enrollment: Enrollment; roomName: string; onClose: () => void }) {
  return (
    <Modal onClose={onClose} width={390}>
      <div className="text-center"><span className="mx-auto grid size-12 place-items-center rounded-full bg-[#E4F3EC] text-xl">🎉</span><h2 className="mt-2 text-[20px] font-extrabold text-ink">{enrollment.child_first_name ?? "Your child"} has a spot!</h2><p className="text-[12px] text-muted">Sunny Grove · family offer preview</p></div>
      <div className={`${card} divide-y divide-[#EDF3FB] px-4`}>{[["Room", roomName], ["First day", enrollment.desired_start_date ? formatDate(enrollment.desired_start_date) : "To be confirmed"], ["Schedule", String(jsonObject(enrollment.schedule).days ?? "Mon–Fri · full day")], ["Tuition", `${money(enrollment.offer_tuition_cents ?? 0)} / month`]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-3 text-[12.5px]"><span className="text-muted">{label}</span><b className="text-right text-ink">{value}</b></div>)}</div>
      {enrollment.offer_expires_at && <div className="rounded-[13px] border border-[#EFCF94] bg-[#FFF8EA] px-3.5 py-3 text-[12px] text-ink">Held until <b>{formatDateTime(enrollment.offer_expires_at)}</b>.</div>}
      <Button type="button" className="py-3 text-sm">Accept &amp; pay {money(enrollment.offer_deposit_cents ?? 0)} deposit</Button>
      <Button type="button" variant="secondary" className="py-3 text-sm">Decline the spot</Button>
      <p className="text-center text-[10.5px] leading-relaxed text-faint">Preview only. Family acceptance happens from the secure offer link delivered to them.</p>
      <button type="button" onClick={onClose} className="text-[11px] font-bold text-primary">Close preview</button>
    </Modal>
  );
}

function ModalHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <div><h2 className="text-[19px] font-extrabold text-ink">{title}</h2><p className="mt-0.5 text-[12.5px] leading-normal text-muted">{subtitle}</p></div>;
}

function ReviewCheck({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-3 text-[12px]">
      <span className="grid size-5 place-items-center rounded-full bg-[#E4F3EC] font-bold text-success">✓</span>
      <span className="text-muted">{label}</span>
      <b className="ml-auto text-right text-ink">{value}</b>
    </div>
  );
}

function FamilyPill({ enrollment, detail }: { enrollment: Enrollment; detail?: string }) {
  return <div className="flex w-fit items-center gap-2 rounded-full border-[1.5px] border-[#D6E1F0] bg-canvas py-1.5 pl-1.5 pr-3.5"><Avatar name={enrollment.guardian_name ?? "Family"} size={30} /><span><b className="block text-[12.5px] text-ink">{familyName(enrollment)} · {enrollment.child_first_name ?? "Child"}</b>{detail && <span className="block text-[10px] text-muted">{detail}</span>}</span></div>;
}

function Select({ label, name, options, empty, defaultValue = "", required = false }: { label: string; name: string; options: { id: string; name: string }[]; empty?: string; defaultValue?: string; required?: boolean }) {
  return <label className="flex flex-col gap-[7px]"><span className="text-[13px] font-bold text-ink">{label}</span><select name={name} defaultValue={defaultValue} required={required} className="min-w-0 rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-3 text-[13px] text-ink outline-none focus:border-primary">{empty !== undefined && <option value="" disabled={required}>{empty}</option>}{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
}

function ModalButtons({ onClose, pending, submit, disabled = false }: { onClose: () => void; pending: boolean; submit: string; disabled?: boolean }) {
  return <div className="flex gap-2.5"><Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || disabled} className="flex-1 py-3 text-sm">{pending ? "Saving…" : submit}</Button></div>;
}

function ToggleSummary({ title, detail }: { title: string; detail: string }) {
  return <div className="flex items-center gap-3 rounded-[13px] bg-canvas px-3.5 py-3"><span className="flex-1"><b className="block text-[12.5px] text-ink">{title}</b><span className="block text-[11px] text-muted">{detail}</span></span><span className="h-[22px] w-[38px] rounded-full bg-primary p-0.5"><span className="ml-auto block size-[18px] rounded-full bg-white" /></span></div>;
}

function CheckLine({ children }: { children: React.ReactNode }) { return <span className="mt-2 flex gap-2 text-[11.5px] leading-relaxed text-ink"><b className="text-success">✓</b>{children}</span>; }
function Label({ children }: { children: React.ReactNode }) { return <b className="text-[10px] tracking-[.07em] text-faint">{children}</b>; }

function documentRows(value: unknown) {
  const data = jsonObject(value);
  return [
    { key: "immunization", label: "Immunization record" },
    { key: "emergency_contacts", label: "Emergency contacts" },
    { key: "medical", label: "Allergy & medical form" },
    { key: "handbook", label: "Signed parent handbook" },
  ].map((document) => {
    const raw = data[document.key];
    const detail = jsonObject(raw);
    return {
      ...document,
      status: typeof raw === "string" ? raw : String(detail.status ?? "missing"),
      requestedAt: typeof detail.requested_at === "string" ? detail.requested_at : null,
    };
  });
}

function jsonObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function familyName(enrollment: Enrollment): string { return enrollment.guardian_name?.split(" ").slice(-1)[0] ?? "Family"; }
function familyLabel(enrollment: EnrollmentTourSlotRow["enrollment"]): string { return enrollment ? `${enrollment.guardian_name?.split(" ").slice(-1)[0] ?? "Family"} · ${enrollment.child_first_name ?? "child"}` : "Booked"; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function money(cents: number): string { return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); }
