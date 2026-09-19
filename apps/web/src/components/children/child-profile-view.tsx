"use client";

import type {
  ChildDocument,
  ChildPickup,
  MedicationDoseRecord,
  ParentDocumentRequestReviewRow,
  PendingParentInvite,
  PickupSecurityEvent,
  Tables,
} from "@dailylog/db";
import { childSetupChecklist, CONSENT_KINDS, formatAge } from "@dailylog/shared";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { medicationLifecycleStatus } from "@/lib/children/medication-status";
import { EditChildModal } from "./edit-child-modal";
import { PickupModal } from "./pickup-modal";
import { InviteParentModal } from "./invite-parent-modal";
import { SetupPanel } from "./setup-panel";
import { RowMenu } from "./row-menu";
import {
  removePickupAction,
  resolvePickupSecurityEventAction,
  reviewPickupAction,
} from "@/lib/children/actions";
import { ParentDocumentWorkflowCard } from "./parent-document-workflow-card";

type Guardian = {
  relationship: string | null;
  is_primary: boolean;
  pickup_authorized: boolean;
  parent: { id: string; full_name: string; email: string; phone: string | null } | null;
};

type Child = Tables<"children"> & {
  classroom: {
    id: string;
    name: string;
    age_group: string | null;
    min_age_months: number | null;
    max_age_months: number | null;
  } | null;
  guardians: Guardian[];
};

// Small donut for the setup banner (design 19a shows "40%" in a ring).
function ProgressRing({ percent }: { percent: number }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className="relative grid size-[52px] flex-none place-items-center">
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden>
        <circle cx="26" cy="26" r={radius} fill="none" stroke="#F0E2C4" strokeWidth="5" />
        <circle
          cx="26"
          cy="26"
          r={radius}
          fill="none"
          stroke="var(--warning)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
          transform="rotate(-90 26 26)"
        />
      </svg>
      <span className="absolute text-[11px] font-extrabold text-warning-text">{percent}%</span>
    </span>
  );
}

function bandLabel(min: number | null, max: number | null): string | null {
  if (min === null || max === null) return null;
  const label = (months: number) =>
    months < 24 ? `${months} mo` : `${Math.round(months / 12)}`;
  return min >= 24 && max >= 24
    ? `${label(min)}–${label(max)} years`
    : `${label(min)}–${max < 24 ? `${max} mo` : `${Math.round(max / 12)} y`}`;
}

type Medication = {
  id: string;
  parent_id: string | null;
  name: string;
  dosage: string;
  schedule: string | null;
  notes: string | null;
  active: boolean;
  signed_at: string | null;
  consented_at: string | null;
  ended_at: string | null;
  parent: { full_name: string } | null;
};

type Consent = { id: string; kind: string; version: string; granted: boolean };
type EditSection = "Details" | "Medical" | "Medications" | "Family & pickups";

function formatDateOnly(value: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-CA", {
    ...options,
    timeZone: "UTC",
  });
}

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const cardTitle = "text-[14px] font-extrabold text-ink";
const th = "font-bold text-[10.5px] tracking-[.07em] text-faint";

export function ChildProfileView({
  child,
  pickups,
  medications,
  medicationLogs,
  consents,
  documents,
  documentRequests,
  pickupSecurityEvents,
  pendingInvites,
  classrooms,
  photoUrl,
  openEdit,
}: {
  child: Child;
  pickups: ChildPickup[];
  medications: Medication[];
  medicationLogs: MedicationDoseRecord[];
  consents: Consent[];
  documents: ChildDocument[];
  documentRequests: ParentDocumentRequestReviewRow[];
  pickupSecurityEvents: PickupSecurityEvent[];
  pendingInvites: PendingParentInvite[];
  classrooms: { id: string; name: string }[];
  photoUrl: string | null;
  openEdit: boolean;
}) {
  const [modal, setModal] = useState<"none" | "edit" | "pickup" | "invite" | "setup">(
    openEdit ? "edit" : "none",
  );
  const [editSection, setEditSection] = useState<EditSection>("Details");
  const openEditor = (section: EditSection = "Details") => {
    setEditSection(section);
    setModal("edit");
  };

  const name = `${child.first_name} ${child.last_name}`;
  const setup = childSetupChecklist({
    ...child,
    guardianCount: child.guardians.filter((g) => g.parent).length,
    pendingInviteCount: pendingInvites.length,
  });

  const meta = [
    child.classroom?.name,
    child.date_of_birth
      ? `born ${formatDateOnly(child.date_of_birth, { month: "short", day: "numeric", year: "numeric" })}`
      : null,
    child.date_of_birth ? formatAge(child.date_of_birth) : null,
    child.enrolled_on
      ? `enrolled ${formatDateOnly(child.enrolled_on, { month: "short", year: "numeric" })}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/* Profile header */}
      <div className="flex items-center gap-3.5 border-b-[1.5px] border-hairline bg-card px-7 py-5">
        <Link
          href="/children"
          className="flex items-center gap-1 text-[13px] font-bold text-primary hover:text-primary-hover"
        >
          <span aria-hidden>‹</span> Children
        </Link>
        <Avatar name={name} src={photoUrl} size={44} />
        <span className="min-w-0">
          <span className="block text-[20px] font-extrabold text-ink">{name}</span>
          <span className="block text-[12.5px] text-muted">{meta}</span>
        </span>
        <span className="flex-1" />
        <a
          href={`/reports-export/attendance-month?month=${new Date().toISOString().slice(0, 7)}&child=${child.id}`}
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2.5 text-[13px] font-bold text-ink hover:bg-canvas"
        >
          Attendance record
        </a>
        <Link
          href={`/messages?child=${child.id}`}
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2.5 text-[13px] font-bold text-ink hover:bg-canvas"
        >
          Message parents
        </Link>
        <button
          type="button"
          onClick={() => openEditor()}
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-[18px] py-2.5 text-[13px] font-bold text-ink hover:bg-canvas"
        >
          Edit profile
        </button>
        <RowMenu childId={child.id} childName={name} presentation="profile" />
      </div>

      <main className="grid flex-1 grid-cols-[1.6fr_1fr] items-start gap-4 p-7">
        {/* ── Left column ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4">
          {setup.incomplete > 0 && (
            <div className="flex items-center gap-3.5 rounded-2xl border border-[#F0E2C4] bg-warning-bg px-[18px] py-3.5">
              <button
                type="button"
                onClick={() => setModal("setup")}
                aria-label={`Review profile setup, ${setup.percent}% complete`}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <ProgressRing percent={setup.percent} />
              </button>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-extrabold text-ink">
                  Profile setup incomplete — {setup.items.filter((i) => i.done).length} of{" "}
                  {setup.items.length} sections
                </span>
                <button
                  type="button"
                  onClick={() => setModal("setup")}
                  className="mt-1 text-[11.5px] font-bold text-warning-text underline-offset-2 hover:underline"
                >
                  Review setup checklist
                </button>
                <span className="block text-[11.5px] leading-normal text-warning-text">
                  Educators see a &ldquo;Profile incomplete&rdquo; flag on this child until
                  these are filled.
                </span>
              </span>
              <span className="flex max-w-[240px] flex-wrap justify-end gap-1.5">
                {setup.items
                  .filter((item) => !item.done)
                  .map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() =>
                        item.key === "parents"
                          ? setModal("invite")
                          : openEditor(
                              item.key === "medical"
                                ? "Medical"
                                : item.key === "emergency"
                                  ? "Family & pickups"
                                  : "Details",
                            )
                      }
                      className="whitespace-nowrap rounded-full border-[1.5px] border-[#F0E2C4] bg-card px-3 py-1.5 text-[11.5px] font-bold text-warning-text hover:bg-white"
                    >
                      {item.label}
                    </button>
                  ))}
              </span>
            </div>
          )}

          {/* Medical & allergies */}
          <section className={card} aria-labelledby="medical-h">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="medical-h" className={cardTitle}>
                Medical &amp; allergies
              </h2>
              {(child.allergies?.length ?? 0) === 0 ? (
                <span className="text-[11.5px] text-faint">none on file</span>
              ) : (
                <span className="rounded-full bg-danger-bg px-2.5 py-[3px] text-[11px] font-bold text-danger">
                  {child.allergies!.length}{" "}
                  {child.allergies!.length === 1 ? "allergy" : "allergies"}
                </span>
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => openEditor("Medical")}
                className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
              >
                Edit
              </button>
            </div>
            <span className={`${th} mb-1.5 block`}>ALLERGIES</span>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(child.allergies ?? []).map((a) => (
                <span
                  key={a}
                  className="flex items-center gap-1.5 rounded-full border border-[#EFC9C9] bg-danger-bg px-2.5 py-1 text-[11.5px] font-bold text-danger"
                >
                  <span aria-hidden>⚠</span>
                  {a}{isSevere(child.medical_notes) ? " · severe" : ""}
                </span>
              ))}
              <button
                type="button"
                onClick={() => openEditor("Medical")}
                className="rounded-full border-[1.5px] border-dashed border-[#D6E1F0] px-2.5 py-1 text-[11.5px] font-semibold text-muted hover:bg-canvas"
              >
                + Add allergy
              </button>
            </div>
            <span className={`${th} mb-1.5 block`}>MEDICAL NOTES</span>
            <p className="text-[12.5px] leading-relaxed text-body">
              {child.medical_notes || <span className="text-faint">No notes.</span>}
            </p>
          </section>

          {/* Medication authorizations */}
          <section className={card} aria-labelledby="meds-h">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="meds-h" className={cardTitle}>
                Medication authorizations
              </h2>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => openEditor("Medications")}
                className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
              >
                + Authorize
              </button>
            </div>
            {medications.length === 0 ? (
              <p className="text-[12.5px] text-faint">None on file.</p>
            ) : (
              <div className="flex flex-col">
                <div className={`grid grid-cols-[1.4fr_1.2fr_1fr_.8fr] gap-2 border-b border-[#EDF3FB] pb-2 ${th}`}>
                  <span>MEDICATION</span>
                  <span>SCHEDULE</span>
                  <span>AUTHORIZED BY</span>
                  <span>STATUS</span>
                </div>
                {medications.map((m) => {
                  const lifecycle = medicationLifecycleStatus(m);
                  return (
                  <div key={m.id} className="grid grid-cols-[1.4fr_1.2fr_1fr_.8fr] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0">
                    <span className="text-[12.5px] font-bold text-ink">
                      {m.name} {m.dosage}
                    </span>
                    <span className="text-[12.5px] text-muted">{m.schedule ?? "—"}</span>
                    <span className="text-[12.5px] text-muted">{m.parent?.full_name ?? "—"}</span>
                    <span>
                      {lifecycle === "active" ? (
                        <span className="rounded-full bg-[#E4F3EC] px-2.5 py-[3px] text-[11px] font-bold text-success">
                          Active
                        </span>
                      ) : lifecycle === "ended" ? (
                        <span className="rounded-full bg-canvas px-2.5 py-[3px] text-[11px] font-bold text-faint">
                          Ended
                        </span>
                      ) : (
                        <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[11px] font-bold text-warning-text">
                          Consent needed
                        </span>
                      )}
                    </span>
                  </div>
                  );
                })}
              </div>
            )}

            <div className="mt-5 border-t border-[#EDF3FB] pt-4">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-[12.5px] font-extrabold text-ink">Recent doses</h3>
                <span className="text-[11px] text-faint">Educator administration record</span>
              </div>
              {medicationLogs.length === 0 ? (
                <p className="text-[12px] text-faint">No doses have been logged.</p>
              ) : (
                <div className="overflow-hidden rounded-[13px] border border-[#EDF3FB]">
                  {medicationLogs.map((dose) => (
                    <div
                      key={dose.id}
                      className="grid grid-cols-[1.2fr_1fr_1.2fr] gap-3 border-b border-[#EDF3FB] px-3.5 py-2.5 text-[11.5px] last:border-b-0"
                    >
                      <span>
                        <b className="block text-ink">{dose.authorization?.name ?? "Medication"}</b>
                        <span className="text-muted">
                          {[dose.dosage_given, dose.route_given].filter(Boolean).join(" · ") || "Dose recorded"}
                        </span>
                      </span>
                      <span className="text-muted">
                        <b className="block text-ink">
                          {new Date(dose.administered_at).toLocaleDateString("en-CA", {
                            month: "short",
                            day: "numeric",
                          })}
                        </b>
                        {new Date(dose.administered_at).toLocaleTimeString("en-CA", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="text-muted">
                        Given by <b className="text-ink">{dose.administered_by_profile?.full_name ?? "staff"}</b>
                        <span className="block">Witness: {dose.witness_profile?.full_name ?? "—"}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {pickupSecurityEvents.length > 0 && (
            <section
              id="pickup-safety"
              className={`${card} scroll-mt-24 ${
                pickupSecurityEvents.some((event) => event.status === "open")
                  ? "border-[#E7A6A0] bg-[#FFF8F7]"
                  : ""
              }`}
              aria-labelledby="pickup-safety-h"
            >
              <div className="mb-3 flex items-center gap-2">
                <h2 id="pickup-safety-h" className={cardTitle}>Pickup safety log</h2>
                {pickupSecurityEvents.some((event) => event.status === "open") && (
                  <span className="rounded-full bg-danger-bg px-2.5 py-[3px] text-[11px] font-bold text-danger">
                    Action required
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2.5">
                {pickupSecurityEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-[12px] border border-[rgba(23,51,91,.1)] bg-card px-3.5 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 size-2 flex-none rounded-full ${
                        event.status === "open" ? "bg-danger" : "bg-success"
                      }`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[12.5px] font-bold text-ink">
                            {event.attempted_name || "Unidentified person"}
                          </span>
                          <span className="text-[11px] text-faint">
                            {new Date(event.created_at).toLocaleString("en-CA", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11.5px] text-muted">
                          Reported by {event.reporter?.full_name ?? "an educator"}
                          {event.notes ? ` · ${event.notes}` : ""}
                        </p>
                        {event.status === "resolved" && (
                          <p className="mt-1 text-[11.5px] font-semibold text-success">
                            Resolved{event.resolver?.full_name ? ` by ${event.resolver.full_name}` : ""}
                          </p>
                        )}
                      </div>
                      {event.status === "open" && (
                        <form action={resolvePickupSecurityEventAction}>
                          <input type="hidden" name="child_id" value={child.id} />
                          <input type="hidden" name="event_id" value={event.id} />
                          <button
                            type="submit"
                            className="rounded-btn border border-[#E7A6A0] px-3 py-1.5 text-[11.5px] font-bold text-danger hover:bg-danger-bg"
                          >
                            Mark resolved
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Authorized pickups */}
          <section className={card} aria-labelledby="pickups-h">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="pickups-h" className={cardTitle}>
                Authorized pickups
              </h2>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setModal("pickup")}
                className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
              >
                + Add pickup person
              </button>
            </div>
            {pickups.length === 0 && child.guardians.length === 0 ? (
              <p className="text-[12.5px] text-faint">No one yet — add a pickup person or link a parent.</p>
            ) : (
              <div className="flex flex-col">
                <div className={`grid grid-cols-[1.4fr_1fr_.6fr_.8fr_130px] gap-2 border-b border-[#EDF3FB] pb-2 ${th}`}>
                  <span>NAME</span>
                  <span>RELATION</span>
                  <span>PIN</span>
                  <span>STATUS</span>
                  <span />
                </div>
                {child.guardians
                  .filter(
                    (g) =>
                      g.parent &&
                      g.pickup_authorized &&
                      !pickups.some(
                        (pickup) =>
                          pickup.full_name.toLocaleLowerCase() ===
                          g.parent!.full_name.toLocaleLowerCase(),
                      ),
                  )
                  .map((g) => (
                    <div key={g.parent!.id} className="grid grid-cols-[1.4fr_1fr_.6fr_.8fr_130px] items-center gap-2 border-b border-[#EDF3FB] py-2.5">
                      <span className="flex items-center gap-2">
                    <Avatar name={g.parent!.full_name} size={26} />
                        <span className="text-[12.5px] font-bold text-ink">{g.parent!.full_name}</span>
                      </span>
                      <span className="text-[12.5px] text-muted">{g.relationship ?? "Parent"}</span>
                      <span className="font-mono text-[12px] text-muted">app</span>
                      <span>
                        <span className="rounded-full bg-[#E7F0FB] px-2.5 py-[3px] text-[11px] font-bold text-primary">
                          {g.is_primary ? "Primary" : "Linked"}
                        </span>
                      </span>
                      <span />
                    </div>
                  ))}
                {pickups.map((p) => (
                  <div key={p.id} className="grid grid-cols-[1.4fr_1fr_.6fr_.8fr_130px] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0">
                    <span className="flex items-center gap-2">
                      <Avatar name={p.full_name} size={26} />
                      <span className="text-[12.5px] font-bold text-ink">{p.full_name}</span>
                    </span>
                    <span className="text-[12.5px] text-muted">{p.relationship ?? "—"}</span>
                    <span className="font-mono text-[12px] font-semibold text-ink">
                      {p.approval_status === "approved" ? p.pin : "—"}
                    </span>
                    <span>
                      <span className={`rounded-full px-2.5 py-[3px] text-[11px] font-bold ${
                        p.approval_status === "pending"
                          ? "bg-[#FFF2DA] text-[#A86A16]"
                          : p.approval_status === "rejected"
                            ? "bg-[#FDE8E8] text-danger"
                            : p.is_primary
                              ? "bg-[#E7F0FB] text-primary"
                              : "bg-[#E4F3EC] text-success"
                      }`}>
                        {p.approval_status === "pending"
                          ? "Under review"
                          : p.approval_status === "rejected"
                            ? "Not approved"
                            : p.is_primary ? "Primary" : "Approved"}
                      </span>
                    </span>
                    {p.approval_status === "pending" ? (
                      <span className="flex items-center gap-2">
                        <form action={reviewPickupAction}>
                          <input type="hidden" name="child_id" value={child.id} />
                          <input type="hidden" name="pickup_id" value={p.id} />
                          <input type="hidden" name="decision" value="approved" />
                          <button type="submit" className="text-[11.5px] font-bold text-success hover:underline">
                            Approve
                          </button>
                        </form>
                        <form action={reviewPickupAction}>
                          <input type="hidden" name="child_id" value={child.id} />
                          <input type="hidden" name="pickup_id" value={p.id} />
                          <input type="hidden" name="decision" value="rejected" />
                          <button type="submit" className="text-[11.5px] font-bold text-danger hover:underline">
                            Reject
                          </button>
                        </form>
                      </span>
                    ) : (
                      <form action={removePickupAction}>
                        <input type="hidden" name="child_id" value={child.id} />
                        <input type="hidden" name="pickup_id" value={p.id} />
                        <button type="submit" className="text-[11.5px] font-bold text-danger hover:underline">
                          Remove
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── Right column ────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className={card} aria-labelledby="family-h">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="family-h" className={cardTitle}>
                Family &amp; contacts
              </h2>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setModal("invite")}
                className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
              >
                Manage
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              {child.guardians
                .filter((g) => g.parent)
                .map((g) => (
                  <div key={g.parent!.id} className="flex items-center gap-2.5">
                    <Avatar name={g.parent!.full_name} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-ink">
                        {g.parent!.full_name}
                      </span>
                      <span className="block truncate text-[11.5px] text-muted">
                        {g.relationship ?? "Parent"}
                        {g.parent!.phone ? ` · ${g.parent!.phone}` : ""}
                      </span>
                    </span>
                    <span className="rounded-full bg-[#E4F3EC] px-2.5 py-[3px] text-[11px] font-bold text-success">
                      Linked
                    </span>
                  </div>
                ))}
              {pendingInvites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-2.5">
                  <span className="grid size-8 flex-none place-items-center rounded-full bg-canvas text-[11px] font-bold text-faint">
                    ?
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-ink">
                      {inv.email ?? "Invite"}
                    </span>
                    <span className="block text-[11.5px] text-muted">
                      {inv.relationship ?? "Parent"} · invite sent {formatShortDate(inv.created_at)}
                    </span>
                  </span>
                  <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[11px] font-bold text-warning-text">
                    Pending
                  </span>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setModal("invite")}
                className="mt-1 rounded-btn border-[1.5px] border-dashed border-[#D6E1F0] px-3 py-2.5 text-[12.5px] font-bold text-primary hover:bg-canvas"
              >
                + Invite or link a parent
              </button>
            </div>
          </section>

          <section className={card} aria-labelledby="room-h">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="room-h" className={cardTitle}>
                Room &amp; schedule
              </h2>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => openEditor("Details")}
                className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
              >
                Move room
              </button>
            </div>
            <div className="rounded-xl bg-canvas px-3.5 py-3">
              <span className="block text-[13.5px] font-extrabold text-ink">
                {child.classroom?.name ?? "No room assigned"}
              </span>
              {child.classroom && (
                <span className="block text-[11.5px] text-muted">
                  {bandLabel(child.classroom.min_age_months, child.classroom.max_age_months) ??
                    child.classroom.age_group ??
                    ""}
                </span>
              )}
              <ScheduleSummary value={child.setup_state} />
            </div>
            <p className="mt-2.5 text-[11.5px] text-faint">
              This recurring booking drives attendance expectations and billing.
            </p>
          </section>

          <ParentDocumentWorkflowCard
            childId={child.id}
            childName={child.first_name}
            requests={documentRequests}
          />

          <section className={card} aria-labelledby="consents-h">
            <h2 id="consents-h" className={`${cardTitle} mb-3`}>
              Consents &amp; documents
            </h2>
            <div className="flex flex-col gap-2">
              {CONSENT_KINDS.map((kind) => {
                const consent = consents.find((candidate) => candidate.kind === kind);
                const status = !consent ? "Request" : consent.granted ? "Signed" : "Declined";
                return (
                  <div key={kind} className="flex items-center gap-2.5">
                    <span className="flex-1 text-[12.5px] font-semibold text-ink">{kind}</span>
                    <span className={`text-[11.5px] font-bold ${consent?.granted ? "text-success" : consent ? "text-danger" : "text-warning-text"}`}>
                      {status}
                    </span>
                  </div>
                );
              })}
              {documents.map((document) => (
                <div key={document.id} className="flex items-center gap-2.5 border-t border-[#EDF3FB] pt-2">
                  <span aria-hidden className="text-faint">▧</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
                    {document.title}
                  </span>
                  <Link
                    href={`/documents/${document.id}`}
                    target="_blank"
                    className="text-[11.5px] font-bold text-primary hover:underline"
                  >
                    PDF
                  </Link>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      {modal === "edit" && (
        <EditChildModal
          child={child}
          classrooms={classrooms}
          pickups={pickups}
          medications={medications}
          consents={consents}
          documents={documents}
          guardians={child.guardians}
          pendingInvites={pendingInvites}
          photoUrl={photoUrl}
          initialTab={editSection}
          onClose={() => setModal("none")}
        />
      )}
      {modal === "pickup" && (
        <PickupModal childId={child.id} childName={child.first_name} onClose={() => setModal("none")} />
      )}
      {modal === "invite" && (
        <InviteParentModal childId={child.id} childName={child.first_name} onClose={() => setModal("none")} />
      )}
      {modal === "setup" && (
        <SetupPanel
          childName={name}
          roomName={child.classroom?.name ?? null}
          enrolledOn={child.enrolled_on}
          setup={setup}
          onFix={(key) =>
            key === "parents"
              ? setModal("invite")
              : openEditor(
                  key === "medical"
                    ? "Medical"
                    : key === "emergency"
                      ? "Family & pickups"
                      : "Details",
                )
          }
          onClose={() => setModal("none")}
        />
      )}
    </>
  );
}

function isSevere(notes: string | null): boolean {
  return /severe|anaphyla|epipen/i.test(notes ?? "");
}

function formatShortDate(value: string | null): string {
  if (!value) return "recently";
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function ScheduleSummary({ value }: { value: unknown }) {
  const profileState = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const schedule = profileState.weekly_schedule && typeof profileState.weekly_schedule === "object" && !Array.isArray(profileState.weekly_schedule)
    ? (profileState.weekly_schedule as Record<string, unknown>)
    : {};
  const days = [
    ["mon", "M"],
    ["tue", "T"],
    ["wed", "W"],
    ["thu", "T"],
    ["fri", "F"],
  ] as const;
  return (
    <div className="mt-3 grid grid-cols-5 gap-1.5" aria-label="Weekly schedule">
      {days.map(([key, label]) => {
        const status = schedule[key] === "full" || schedule[key] === "half" ? schedule[key] : "off";
        return (
          <span key={key} className="text-center">
            <span className="block text-[9px] font-bold text-faint">{label}</span>
            <span className={`mt-0.5 block rounded-md py-1 text-[9.5px] font-bold capitalize ${status === "off" ? "border border-[#D6E1F0] bg-card text-faint" : "bg-primary text-white"}`}>
              {status}
            </span>
          </span>
        );
      })}
    </div>
  );
}
