"use client";

import type {
  Enrollment,
  EnrollmentFitCheck,
  EnrollmentFitStatus,
  EnrollmentTourSlotRow,
  RoomLiveStatus,
} from "@dailylog/db/queries";
import { formatAge } from "@dailylog/shared";
import { Check, ChevronLeft, CircleAlert, HelpCircle, Minus, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import {
  cancelEnrollmentTourAction,
  messageEnrollmentFamilyAction,
  type EnrollmentActionState,
} from "@/lib/enrollment/actions";
import {
  BookTourModal,
  RequestDocumentsModal,
  SendOfferModal,
} from "./enrollment-flow-modals";

const card = "rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card";

type Dialog = "none" | "documents" | "message" | "offer" | "tour";

const DOCUMENTS = [
  { key: "immunization", label: "Immunization record" },
  { key: "emergency_contacts", label: "Emergency contacts" },
  { key: "medical", label: "Allergy & medical form" },
  { key: "handbook", label: "Signed parent handbook" },
] as const;

export function EnrollmentApplicationView({
  enrollment,
  fitCheck,
  rooms,
  tourSlots,
  educators,
  offerWindowHours,
  timeZone,
}: {
  enrollment: Enrollment;
  fitCheck: EnrollmentFitCheck | null;
  rooms: RoomLiveStatus[];
  tourSlots: EnrollmentTourSlotRow[];
  educators: { id: string; fullName: string }[];
  offerWindowHours: number;
  timeZone: string;
}) {
  const [dialog, setDialog] = useState<Dialog>("none");
  const room = rooms.find((item) => item.id === enrollment.classroom_id);
  const schedule = jsonObject(enrollment.schedule);
  const application = jsonObject(enrollment.application_data);
  const documents = documentRows(enrollment.documents_status);
  const received = documents.filter((item) => item.status === "received").length;
  const family = familyName(enrollment);
  const child = enrollment.child_first_name ?? "Child";
  const tuition = enrollment.offer_tuition_cents ?? numberValue(application.tuition_cents, 118000);
  const deposit = enrollment.offer_deposit_cents ?? 50000;
  const allergy = stringValue(application.allergy ?? application.allergies);
  const host = educators.find((item) => item.id === enrollment.tour_host_id);
  const activities = activityRows(enrollment, host?.fullName);
  const fitStatuses = fitCheck
    ? [fitCheck.capacity_status, fitCheck.age_status, fitCheck.staffing_status]
    : ["unknown"];
  const fitTone = fitStatuses.includes("fail")
    ? "fail"
    : fitStatuses.includes("warning") || fitStatuses.includes("unknown")
      ? "warning"
      : "pass";

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-canvas">
      <header className="flex min-h-[94px] items-center gap-4 border-b-[1.5px] border-hairline bg-card px-9 py-4">
        <Link
          href="/enrollment?modal=pipeline"
          className="flex items-center gap-1 text-[12.5px] font-bold text-primary hover:underline"
        >
          <ChevronLeft size={15} />
          Pipeline
        </Link>
        <Avatar name={`${family} ${child}`} size={44} />
        <span className="min-w-0">
          <h1 className="truncate text-[20px] font-extrabold text-ink">{family} family</h1>
          <p className="truncate text-[12.5px] text-muted">
            {child}
            {enrollment.child_date_of_birth ? ` · ${formatAge(enrollment.child_date_of_birth)}` : ""}
            {` · applying for ${room?.name ?? "a program"}`}
            {enrollment.desired_start_date
              ? ` · wants to start ${formatDate(enrollment.desired_start_date)}`
              : ""}
          </p>
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setDialog("message")}
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-[18px] py-2.5 text-[13px] font-bold text-ink hover:bg-canvas"
        >
          Message
        </button>
        <button
          type="button"
          onClick={() => setDialog("offer")}
          className="rounded-btn bg-primary px-[18px] py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover"
        >
          Send offer
        </button>
      </header>

      <main className="grid flex-1 items-start gap-5 px-9 py-[22px] xl:grid-cols-[minmax(0,1fr)_298px]">
        <div className="flex min-w-0 flex-col gap-[18px]">
          <section className={`${card} flex flex-col gap-3 p-[18px]`}>
            <h2 className="text-[15px] font-extrabold text-ink">Application</h2>
            <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
              <ApplicationField
                label="PARENT 1"
                primary={enrollment.guardian_name ?? "Not provided"}
                secondary={contactLine(enrollment.guardian_phone, enrollment.guardian_email)}
              />
              <ApplicationField
                label="PARENT 2"
                primary={stringValue(application.parent_2) || "Not provided"}
                secondary={contactLine(
                  stringValue(application.parent_2_phone),
                  stringValue(application.parent_2_email),
                )}
              />
              <ApplicationField
                label="SCHEDULE"
                primary={scheduleTitle(schedule)}
                secondary={`${stringValue(schedule.dropoff) || "7:30"} drop-off · ${
                  stringValue(schedule.pickup) || "5:30"
                } pickup`}
              />
              <ApplicationField
                label="START"
                primary={`${
                  enrollment.desired_start_date
                    ? formatDate(enrollment.desired_start_date)
                    : "Flexible"
                } · ${room?.name ?? "Program open"}`}
                secondary={
                  stringValue(application.start_flexibility) || "Start date confirmed with family"
                }
              />
            </div>
            {allergy && allergy.toLowerCase() !== "none" && (
              <div className="flex items-center gap-2.5 rounded-[12px] bg-warning-bg px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
                <span className="size-2 flex-none rounded-full bg-[#B0782B]" />
                <span>
                  <b>{allergy}</b> noted on the application — flagged for the kitchen and room staff if enrolled.
                </span>
              </div>
            )}
          </section>

          <section className={`${card} overflow-hidden`}>
            <div className="flex items-center gap-2 border-b-[1.5px] border-[#EDF3FB] px-[18px] py-3.5">
              <h2 className="text-[15px] font-extrabold text-ink">Documents</h2>
              <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[12px] font-bold text-warning-text">
                {received} of {documents.length}
              </span>
              <span className="ml-auto text-[12px] text-faint">
                requested from the family in one tap
              </span>
            </div>
            {documents.map((document) => {
              const complete = document.status === "received";
              return (
                <div
                  key={document.key}
                  className={`flex items-center gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3 last:border-b-0 ${
                    complete ? "" : "bg-[#FFFDF8]"
                  }`}
                >
                  {complete ? (
                    <Check size={15} strokeWidth={2.4} className="flex-none text-success" />
                  ) : (
                    <Minus size={15} className="flex-none text-warning-text" />
                  )}
                  <span className="flex-1 text-[13px] text-ink">{document.label}</span>
                  {complete ? (
                    <span className="text-[12px] text-faint">
                      {document.receivedAt ? `received ${formatDateTime(document.receivedAt)}` : "received"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDialog("documents")}
                      className="text-[12px] font-bold text-primary hover:underline"
                    >
                      {document.status === "requested" ? "Requested" : "Request"}
                    </button>
                  )}
                </div>
              );
            })}
          </section>

          <section className={`${card} flex flex-col gap-3 p-[18px]`}>
            <h2 className="text-[15px] font-extrabold text-ink">Notes &amp; activity</h2>
            {activities.map((activity) => (
              <div key={`${activity.date}-${activity.text}`} className="flex gap-3">
                <span className="min-w-[44px] text-[11px] font-bold text-faint">
                  {activity.date}
                </span>
                <span className="text-[12px] leading-relaxed text-ink">{activity.text}</span>
              </div>
            ))}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-[18px]">
          <section className={`rounded-2xl border-[1.5px] bg-card p-4 ${
            fitTone === "fail"
              ? "border-[#EFC9C9]"
              : fitTone === "warning"
                ? "border-[#EFCF94]"
                : "border-[#BFE3CF]"
          }`}>
            <h2 className="text-[14px] font-extrabold text-ink">Fit check</h2>
            <CheckLine status={fitCheck?.capacity_status ?? "unknown"}>
              {fitCheck?.capacity_message ?? "Choose a room and first day to check projected capacity."}
            </CheckLine>
            <CheckLine status={fitCheck?.age_status ?? "unknown"}>
              {fitCheck?.age_message ?? "Add the child birth date and choose a room to confirm age fit."}
            </CheckLine>
            <CheckLine status={fitCheck?.staffing_status ?? "unknown"}>
              {fitCheck?.staffing_message ?? "Choose a room and first day to check published coverage."}
            </CheckLine>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              Capacity and age are enforced again when the offer is sent. Staffing uses the published first-day coverage plan and includes active offer holds.
            </p>
          </section>

          <section className={`${card} p-4`}>
            <h2 className="text-[14px] font-extrabold text-ink">Tuition estimate</h2>
            <MoneyLine
              label={`${room?.name ?? "Program"} · ${scheduleTitle(schedule).toLowerCase()}`}
              value={`${money(tuition)} / mo`}
            />
            <MoneyLine label="Deposit at acceptance" value={money(deposit)} />
            <MoneyLine
              label="Sibling discount"
              value={stringValue(application.sibling_discount) || "—"}
              muted={!application.sibling_discount}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              The offer email includes this estimate and the deposit invoice.
            </p>
          </section>

          <section className={`${card} p-4`}>
            <h2 className="text-[14px] font-extrabold text-ink">Tour</h2>
            {enrollment.tour_at ? (
              <>
                <div className="mt-3 flex items-center gap-2.5">
                  <span className="whitespace-nowrap rounded-[8px] bg-tint px-2 py-1.5 text-[11px] font-bold text-primary">
                    {formatTourWhen(enrollment.tour_at, timeZone)}
                  </span>
                  <span className="text-[12.5px] text-ink">
                    with {host?.fullName ?? "host to confirm"} · {room?.name ?? "Program"}
                  </span>
                </div>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setDialog("tour")}
                    className="text-[12px] font-bold text-primary hover:underline"
                  >
                    Reschedule
                  </button>
                  <form action={cancelEnrollmentTourAction}>
                    <input type="hidden" name="enrollment_id" value={enrollment.id} />
                    <button type="submit" className="text-[12px] font-bold text-danger hover:underline">
                      Cancel
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[12px] text-muted">No tour is currently scheduled.</span>
                <button
                  type="button"
                  onClick={() => setDialog("tour")}
                  className="text-[12px] font-bold text-primary hover:underline"
                >
                  Schedule
                </button>
              </div>
            )}
          </section>
        </aside>
      </main>

      {dialog === "documents" && (
        <RequestDocumentsModal enrollment={enrollment} onClose={() => setDialog("none")} />
      )}
      {dialog === "message" && (
        <MessageFamilyModal enrollment={enrollment} onClose={() => setDialog("none")} />
      )}
      {dialog === "offer" && (
        <SendOfferModal
          enrollment={enrollment}
          rooms={rooms}
          defaultWindow={offerWindowHours}
          onClose={() => setDialog("none")}
        />
      )}
      {dialog === "tour" && (
        <BookTourModal
          enrollment={enrollment}
          slots={tourSlots}
          educators={educators}
          onClose={() => setDialog("none")}
        />
      )}
    </div>
  );
}

function MessageFamilyModal({ enrollment, onClose }: { enrollment: Enrollment; onClose: () => void }) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(
    messageEnrollmentFamilyAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={460}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Message {familyName(enrollment)} family</h2>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
          This goes to {enrollment.guardian_email ?? "the email on the application"} and remains attributed to your center.
        </p>
      </div>
      {state.ok ? (
        <>
          <Notice tone="success">Message queued for delivery.</Notice>
          <button
            type="button"
            onClick={onClose}
            className="rounded-btn bg-primary px-5 py-3 text-[13px] font-bold text-white"
          >
            Done
          </button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="enrollment_id" value={enrollment.id} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink">Subject</span>
            <input
              name="subject"
              defaultValue={`Sunny Grove enrollment for ${enrollment.child_first_name ?? "your family"}`}
              maxLength={140}
              className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-3 text-[13px] text-ink outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink">Message</span>
            <textarea
              name="message"
              required
              rows={6}
              placeholder="Write a note to the family…"
              className="resize-none rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-3 text-[13px] leading-relaxed text-ink outline-none focus:border-primary"
            />
          </label>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-btn border-[1.5px] border-[#D6E1F0] px-5 py-2.5 text-[13px] font-bold text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-btn bg-primary px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send message"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ApplicationField({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <div>
      <span className="block text-[10.5px] font-bold tracking-[.07em] text-faint">{label}</span>
      <span className="mt-0.5 block text-[13px] font-bold text-ink">{primary}</span>
      <span className="block text-[12px] text-muted">{secondary}</span>
    </div>
  );
}

function CheckLine({
  status,
  children,
}: {
  status: EnrollmentFitStatus;
  children: React.ReactNode;
}) {
  const icon = status === "pass"
    ? <Check size={14} strokeWidth={2.4} className="flex-none text-success" />
    : status === "fail"
      ? <X size={14} strokeWidth={2.4} className="flex-none text-danger" />
      : status === "warning"
        ? <CircleAlert size={14} strokeWidth={2.2} className="flex-none text-warning-text" />
        : <HelpCircle size={14} strokeWidth={2.2} className="flex-none text-faint" />;
  return (
    <span className="mt-3 flex items-center gap-2.5 text-[12.5px] leading-relaxed text-ink">
      {icon}
      {children}
    </span>
  );
}

function MoneyLine({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="mt-3 flex items-start justify-between gap-3 text-[12.5px]">
      <span className="text-muted">{label}</span>
      <span className={`whitespace-nowrap font-bold ${muted ? "text-faint" : "text-ink"}`}>
        {value}
      </span>
    </div>
  );
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function familyName(enrollment: Enrollment): string {
  return enrollment.guardian_name?.split(" ").slice(-1)[0] ?? "Family";
}

function contactLine(phone: string | null | undefined, email: string | null | undefined): string {
  return [phone, email].filter(Boolean).join(" · ") || "Contact details not provided";
}

function scheduleTitle(schedule: Record<string, unknown>): string {
  const label = stringValue(schedule.label);
  if (label) return label;
  const days = numberValue(schedule.days_per_week, 5);
  return `${days === 5 ? "Mon–Fri" : `${days} days / week`} · ${
    stringValue(schedule.day_length) || "full day"
  }`;
}

function documentRows(value: unknown) {
  const statuses = jsonObject(value);
  return DOCUMENTS.map((document) => {
    const raw = statuses[document.key];
    const detail = jsonObject(raw);
    return {
      ...document,
      status: typeof raw === "string" ? raw : stringValue(detail.status) || "missing",
      receivedAt: stringValue(detail.received_at) || null,
    };
  });
}

function activityRows(enrollment: Enrollment, hostName?: string) {
  const rows: { date: string; text: string }[] = [];
  if (enrollment.tour_at) {
    rows.push({
      date: formatDateTime(enrollment.tour_at),
      text: `Tour confirmed · host ${hostName ?? "to confirm"} · reminder scheduled automatically`,
    });
  }
  if (enrollment.tour_notes || enrollment.notes) {
    rows.push({
      date: enrollment.updated_at ? formatDateTime(enrollment.updated_at) : "Note",
      text: `Note from family: ${enrollment.tour_notes ?? enrollment.notes}`,
    });
  }
  if (enrollment.created_at) {
    rows.push({
      date: formatDateTime(enrollment.created_at),
      text: `Inquiry received via ${enrollment.source ?? "direct entry"} · welcome response sent`,
    });
  }
  return rows.length > 0 ? rows : [{ date: "—", text: "No activity recorded yet." }];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}

function formatTourWhen(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}
