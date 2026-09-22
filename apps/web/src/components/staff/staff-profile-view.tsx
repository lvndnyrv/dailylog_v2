"use client";

import type { StaffRegularScheduleRow, StaffRow } from "@dailylog/db/queries";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { deactivateStaffAction } from "@/lib/staff/actions";
import { Modal } from "@/components/ui/modal";
import { EditStaffModal } from "./edit-staff-modal";
import {
  CredentialReviewCard,
  type CredentialSubmissionWithUrl,
} from "./credential-review-card";
import {
  StaffPermissionsModal,
  type StaffPermissionMatrixData,
} from "./staff-permissions-modal";
import { StaffDocumentsCard, type StaffPrivateDocument } from "./staff-documents-card";
import { CredentialReminderButton } from "./credential-row-action";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const cardTitle = "text-[14px] font-extrabold text-ink";
const th = "font-bold text-[10.5px] tracking-[.07em] text-faint";

const ROLE_LABELS: Record<string, string> = {
  owner_admin: "Owner admin",
  admin: "Delegated admin",
  educator: "Educator",
};

export function StaffProfileView({
  member,
  openEdit,
  credentialSubmissions,
  regularSchedule,
  currentProfileId,
  permissionMatrix,
  privateDocuments,
  ownerView,
}: {
  member: StaffRow;
  openEdit: boolean;
  credentialSubmissions: CredentialSubmissionWithUrl[];
  regularSchedule: StaffRegularScheduleRow[];
  currentProfileId: string | null;
  permissionMatrix: StaffPermissionMatrixData | null;
  privateDocuments: StaffPrivateDocument[];
  ownerView: boolean;
}) {
  const [modal, setModal] = useState<"none" | "edit" | "deactivate" | "permissions">(
    openEdit ? "edit" : "none",
  );
  const profile = member.profile!;
  const certs = member.certifications ?? [];
  const backgroundClearance = certs.find((cert) =>
    /(background|criminal record|vulnerable sector)/i.test(cert.item),
  );
  const backgroundClearancePending =
    member.background_check_required &&
    (!backgroundClearance ||
      !backgroundClearance.document_id ||
      !backgroundClearance.issued ||
      (backgroundClearance.expires_on != null &&
        backgroundClearance.expires_on < new Date().toISOString().slice(0, 10)));
  const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const scheduledMinutes = regularSchedule.reduce((total, day) => {
    const [startHour = 0, startMinute = 0] = day.starts_local.split(":").map(Number);
    const [endHour = 0, endMinute = 0] = day.ends_local.split(":").map(Number);
    return total + Math.max(
      0,
      endHour * 60 + endMinute - startHour * 60 - startMinute - day.unpaid_break_minutes,
    );
  }, 0);
  const shortTime = (value: string) => value.slice(0, 5);
  const reminderCutoff = new Date();
  reminderCutoff.setDate(reminderCutoff.getDate() + 60);

  const meta = [
    member.job_title ?? ROLE_LABELS[profile.role] ?? profile.role,
    profile.classroom?.name,
    member.started_on
      ? `joined ${new Date(member.started_on).toLocaleDateString("en-CA", { month: "short", year: "numeric" })}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="flex items-center gap-3.5 border-b-[1.5px] border-hairline bg-card px-7 py-5">
        <Link href="/staff" aria-label="Back to staff" className="text-faint hover:text-muted">
          ←
        </Link>
        <Avatar name={profile.full_name} size={44} />
        <span className="min-w-0">
          <span className="block text-[20px] font-extrabold text-ink">{profile.full_name}</span>
          <span className="block text-[12.5px] text-muted">{meta}</span>
        </span>
        <span className="flex-1" />
        {profile.id === currentProfileId ? (
          <button
            type="button"
            disabled
            title="This is your own profile"
            className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2.5 text-[13px] font-bold text-faint"
          >
            Message
          </button>
        ) : (
          <Link
            href={`/staff/${member.id}/messages`}
            className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2.5 text-[13px] font-bold text-primary hover:bg-canvas"
          >
            Message
          </Link>
        )}
        <button
          type="button"
          onClick={() => setModal("edit")}
          className="rounded-btn bg-primary px-[18px] py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover"
        >
          Edit profile
        </button>
      </div>

      <main className="grid flex-1 grid-cols-[1.6fr_1fr] items-start gap-4 p-7">
        <div className="flex min-w-0 flex-col gap-4">
          {backgroundClearancePending && (
            <section className={`${card} border-warning/50 bg-warning-bg/40`}>
              <h2 className={cardTitle}>Supervision restriction</h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                This invitation requires an approved background check. Until
                its original is verified, this educator remains visible to the
                team but does not count toward room ratios or floater coverage.
              </p>
              <Link
                href="/compliance"
                className="mt-3 inline-block text-[12.5px] font-bold text-primary hover:text-primary-hover"
              >
                Review the compliance checklist →
              </Link>
            </section>
          )}
          {credentialSubmissions.length > 0 && (
            <section className={card} aria-labelledby="credential-review-h">
              <div className="mb-3 flex items-center gap-2">
                <h2 id="credential-review-h" className={cardTitle}>Credential renewals</h2>
                <span className="flex-1" />
                {credentialSubmissions.some((submission) => submission.status === "pending") && (
                  <span className="rounded-full bg-warning-bg px-2.5 py-1 text-[11px] font-bold text-warning-text">
                    {credentialSubmissions.filter((submission) => submission.status === "pending").length} to review
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2.5">
                {credentialSubmissions.slice(0, 5).map((submission) => (
                  <CredentialReviewCard key={submission.id} submission={submission} />
                ))}
              </div>
              <p className="mt-2.5 text-[11.5px] text-faint">
                Verification updates the compliance register and clears the educator&apos;s reminder.
              </p>
            </section>
          )}

          {/* Certifications */}
          <section className={card} aria-labelledby="certs-h">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="certs-h" className={cardTitle}>
                Certifications &amp; clearances
              </h2>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setModal("edit")}
                className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
              >
                + Add
              </button>
            </div>
            {certs.length === 0 ? (
              <p className="text-[12.5px] text-faint">
                Nothing on file yet — add First Aid, CPR, background check…
              </p>
            ) : (
              <div className="flex flex-col">
                <div className={`grid grid-cols-[1.5fr_1fr_.8fr_1.1fr_92px] gap-2 border-b border-[#EDF3FB] pb-2 ${th}`}>
                  <span>ITEM</span>
                  <span>ISSUER</span>
                  <span>ISSUED</span>
                  <span>STATUS</span>
                  <span>ACTION</span>
                </div>
                {certs.map((cert, i) => {
                  const needsReminder = Boolean(
                    cert.missing ||
                      (cert.expires_on && new Date(`${cert.expires_on}T12:00:00`) <= reminderCutoff),
                  );
                  return <div
                    key={`${cert.item}-${i}`}
                    className="grid grid-cols-[1.5fr_1fr_.8fr_1.1fr_92px] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0"
                  >
                    <span className="text-[12.5px] font-bold text-ink">{cert.item}</span>
                    <span className="text-[12.5px] text-muted">{cert.issuer ?? "—"}</span>
                    <span className="text-[12.5px] text-muted">{cert.issued ?? "—"}</span>
                    <span className="text-[12.5px]">
                      {cert.missing ? (
                        <span className="font-bold text-danger">Missing · required</span>
                      ) : cert.expires_on &&
                        cert.expires_on < new Date().toISOString().slice(0, 10) ? (
                        <span className="font-bold text-danger">Expired</span>
                      ) : cert.expires_on ? (
                        <span className="text-muted">
                          Valid · until{" "}
                          {new Date(cert.expires_on).toLocaleDateString("en-CA", {
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      ) : (
                        <span className="font-bold text-success">On file</span>
                      )}
                    </span>
                    <span className="text-right">
                      {needsReminder && cert.credential_id ? (
                        <CredentialReminderButton credentialId={cert.credential_id} staffName={profile.full_name} />
                      ) : cert.document_id ? (
                        <a href={`/documents/${cert.document_id}`} target="_blank" rel="noreferrer" className="text-[11.5px] font-bold text-primary hover:text-primary-hover">
                          View ↗
                        </a>
                      ) : (
                        <span className="text-[11.5px] text-faint">—</span>
                      )}
                    </span>
                  </div>;
                })}
                <p className="pt-2.5 text-[11.5px] text-faint">
                  Expiry status is tracked on the{" "}
                  <Link href="/compliance" className="font-bold text-primary hover:text-primary-hover">
                    Compliance register
                  </Link>
                  ; automatic reminders arrive with notifications.
                </p>
              </div>
            )}
          </section>

          <section className={card}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className={cardTitle}>Regular schedule</h2>
              {regularSchedule.length > 0 && (
                <span className="text-[11.5px] text-faint">
                  {(scheduledMinutes / 60).toFixed(scheduledMinutes % 60 === 0 ? 0 : 1)} h/week
                </span>
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setModal("edit")}
                className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
              >
                Edit schedule
              </button>
            </div>
            {regularSchedule.length === 0 ? (
              <p className="text-[12.5px] text-faint">
                No regular hours published yet. Add them so this educator sees upcoming shifts in My time.
              </p>
            ) : (
              <div className="grid grid-cols-5 gap-2 max-[1100px]:grid-cols-3">
                {regularSchedule.map((day) => (
                  <div key={day.id} className="rounded-xl bg-canvas px-2.5 py-2 text-center">
                    <span className="block text-[10.5px] font-bold uppercase tracking-[.06em] text-faint">
                      {weekdayNames[day.weekday - 1]}
                    </span>
                    <span className="mt-1 block text-[11.5px] font-bold text-ink">
                      {shortTime(day.starts_local)}–{shortTime(day.ends_local)}
                    </span>
                    {day.classroom && (
                      <span className="mt-0.5 block truncate text-[10.5px] text-muted">
                        {day.classroom.name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={card}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className={cardTitle}>Permissions</h2>
              <span className="flex-1" />
              {permissionMatrix && (
                <button
                  type="button"
                  onClick={() => setModal("permissions")}
                  className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
                >
                  Open matrix
                </button>
              )}
            </div>
            <p className="text-[12.5px] leading-relaxed text-body">
              Inherited from the{" "}
              <b className="text-ink">
                {permissionMatrix?.role_name ?? ROLE_LABELS[profile.role] ?? profile.role}
              </b>{" "}
              role · {permissionMatrix?.overrides.length ?? 0}{" "}
              {(permissionMatrix?.overrides.length ?? 0) === 1 ? "override" : "overrides"}.{" "}
              {profile.role === "educator"
                ? "Room-specific changes can refine access without changing the whole role."
                : "Center-wide changes apply in addition to role defaults."}
            </p>
            <Link href="/staff?tab=roles" className="mt-2 inline-block text-[11.5px] font-bold text-primary hover:text-primary-hover">
              Roles overview →
            </Link>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section className={card}>
            <h2 className={`${cardTitle} mb-3`}>Contact</h2>
            <dl className="flex flex-col gap-2.5">
              <div className="flex justify-between gap-3">
                <dt className="text-[12.5px] text-muted">Phone</dt>
                <dd className="text-[12.5px] font-semibold text-ink">
                  {profile.phone || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[12.5px] text-muted">Email</dt>
                <dd className="min-w-0 truncate text-[12.5px] font-semibold text-ink">
                  {profile.email}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[12.5px] text-muted">Employment</dt>
                <dd className="text-[12.5px] font-semibold text-ink">
                  {member.employment_type?.replace("_", " ") ?? "—"}
                </dd>
              </div>
            </dl>
          </section>

          <StaffDocumentsCard staffId={member.id} documents={privateDocuments} ownerView={ownerView} />

          <section className={`${card} border-danger-bg`}>
            <h2 className={`${cardTitle} mb-2`}>Leaving the center?</h2>
            <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
              Deactivating removes them from the roster and ends their access.
              History stays for compliance.
            </p>
            <button
              type="button"
              onClick={() => setModal("deactivate")}
              className="rounded-btn border-[1.5px] border-[#EFC9C9] px-4 py-2.5 text-[13px] font-bold text-danger hover:bg-danger-bg"
            >
              Deactivate
            </button>
          </section>
        </div>
      </main>

      {modal === "edit" && (
        <EditStaffModal
          member={member}
          regularSchedule={regularSchedule}
          onClose={() => setModal("none")}
        />
      )}

      {modal === "permissions" && permissionMatrix && (
        <StaffPermissionsModal
          matrix={permissionMatrix}
          staffId={member.id}
          viewerProfileId={currentProfileId}
          onClose={() => setModal("none")}
        />
      )}

      {modal === "deactivate" && (
        <Modal onClose={() => setModal("none")}>
          <div>
            <h2 className="text-[19px] font-extrabold text-ink">
              Deactivate {profile.full_name}?
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
              They leave the roster and lose console/app access. Logs and history
              stay for compliance.
            </p>
          </div>
          <form action={deactivateStaffAction} className="flex gap-2.5">
            <input type="hidden" name="staff_id" value={member.id} />
            <button
              type="button"
              onClick={() => setModal("none")}
              className="flex-1 rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-sm font-bold text-ink hover:bg-canvas"
            >
              Keep active
            </button>
            <button
              type="submit"
              className="flex-1 rounded-btn bg-danger px-4 py-3 text-sm font-bold text-white hover:brightness-95"
            >
              Deactivate
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
