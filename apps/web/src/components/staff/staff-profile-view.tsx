"use client";

import type { StaffRow } from "@dailylog/db/queries";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { deactivateStaffAction } from "@/lib/staff/actions";
import { Modal } from "@/components/ui/modal";
import { EditStaffModal } from "./edit-staff-modal";

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
}: {
  member: StaffRow;
  openEdit: boolean;
}) {
  const [modal, setModal] = useState<"none" | "edit" | "deactivate">(
    openEdit ? "edit" : "none",
  );
  const profile = member.profile!;
  const certs = member.certifications ?? [];

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
        <button
          type="button"
          disabled
          title="Messaging arrives in Phase 3"
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2.5 text-[13px] font-bold text-faint"
        >
          Message
        </button>
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
                <div className={`grid grid-cols-[1.5fr_1fr_.8fr_1.2fr] gap-2 border-b border-[#EDF3FB] pb-2 ${th}`}>
                  <span>ITEM</span>
                  <span>ISSUER</span>
                  <span>ISSUED</span>
                  <span>STATUS</span>
                </div>
                {certs.map((cert, i) => (
                  <div
                    key={`${cert.item}-${i}`}
                    className="grid grid-cols-[1.5fr_1fr_.8fr_1.2fr] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0"
                  >
                    <span className="text-[12.5px] font-bold text-ink">{cert.item}</span>
                    <span className="text-[12.5px] text-muted">{cert.issuer ?? "—"}</span>
                    <span className="text-[12.5px] text-muted">{cert.issued ?? "—"}</span>
                    <span className="text-[12.5px]">
                      {cert.expires_on ? (
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
                  </div>
                ))}
                <p className="pt-2.5 text-[11.5px] text-faint">
                  Expiry reminders arrive with compliance (Phase 5).
                </p>
              </div>
            )}
          </section>

          {/* Schedule — later phase */}
          <section className={card}>
            <h2 className={`${cardTitle} mb-2`}>Regular schedule</h2>
            <p className="text-[12.5px] text-faint">
              Weekly schedules and shift cover arrive with attendance (Phase 2).
            </p>
          </section>

          {/* Permissions — read-only summary */}
          <section className={card}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className={cardTitle}>Permissions</h2>
              <span className="flex-1" />
              <Link href="/staff?tab=roles" className="text-[12.5px] font-bold text-primary hover:text-primary-hover">
                Roles overview
              </Link>
            </div>
            <p className="text-[12.5px] leading-relaxed text-body">
              Inherited from the{" "}
              <b className="text-ink">{ROLE_LABELS[profile.role] ?? profile.role}</b> role · no
              overrides.{" "}
              {profile.role === "educator"
                ? "No billing, enrollment or staff access."
                : "Full console access within this center."}
            </p>
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

          <section className={card}>
            <h2 className={`${cardTitle} mb-2`}>Documents</h2>
            <p className="text-[12.5px] text-faint">
              Contracts and files arrive with the compliance vault (Phase 5).
            </p>
          </section>

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

      {modal === "edit" && <EditStaffModal member={member} onClose={() => setModal("none")} />}

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
