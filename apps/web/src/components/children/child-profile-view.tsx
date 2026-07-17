"use client";

import type { ChildPickup, PendingParentInvite, Tables } from "@dailylog/db";
import { childSetupChecklist, formatAge } from "@dailylog/shared";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { EditChildModal } from "./edit-child-modal";
import { PickupModal } from "./pickup-modal";
import { InviteParentModal } from "./invite-parent-modal";
import { SetupPanel } from "./setup-panel";
import { removePickupAction } from "@/lib/children/actions";

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
  name: string;
  dosage: string;
  schedule: string | null;
  active: boolean;
  parent: { full_name: string } | null;
};

type Consent = { id: string; kind: string; version: string; granted: boolean };

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const cardTitle = "text-[14px] font-extrabold text-ink";
const th = "font-bold text-[10.5px] tracking-[.07em] text-faint";

export function ChildProfileView({
  child,
  pickups,
  medications,
  consents,
  pendingInvites,
  classrooms,
  openEdit,
}: {
  child: Child;
  pickups: ChildPickup[];
  medications: Medication[];
  consents: Consent[];
  pendingInvites: PendingParentInvite[];
  classrooms: { id: string; name: string }[];
  openEdit: boolean;
}) {
  const [modal, setModal] = useState<"none" | "edit" | "pickup" | "invite" | "setup">(
    openEdit ? "edit" : "none",
  );

  const name = `${child.first_name} ${child.last_name}`;
  const setup = childSetupChecklist({
    ...child,
    guardianCount: child.guardians.filter((g) => g.parent).length,
    pendingInviteCount: pendingInvites.length,
  });

  const meta = [
    child.classroom?.name,
    child.date_of_birth
      ? `born ${new Date(child.date_of_birth).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}`
      : null,
    child.date_of_birth ? formatAge(child.date_of_birth) : null,
    child.enrolled_on
      ? `enrolled ${new Date(child.enrolled_on).toLocaleDateString("en-CA", { month: "short", year: "numeric" })}`
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
        <Avatar name={name} size={44} />
        <span className="min-w-0">
          <span className="block text-[20px] font-extrabold text-ink">{name}</span>
          <span className="block text-[12.5px] text-muted">{meta}</span>
        </span>
        <span className="flex-1" />
        <Link
          href={`/messages?child=${child.id}`}
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2.5 text-[13px] font-bold text-ink hover:bg-canvas"
        >
          Message parents
        </Link>
        <button
          type="button"
          onClick={() => setModal("edit")}
          className="rounded-btn bg-primary px-[18px] py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover"
        >
          Edit profile
        </button>
      </div>

      <main className="grid flex-1 grid-cols-[1.6fr_1fr] items-start gap-4 p-7">
        {/* ── Left column ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4">
          {setup.incomplete > 0 && (
            <div className="flex items-center gap-3.5 rounded-2xl border border-[#F0E2C4] bg-warning-bg px-[18px] py-3.5">
              <ProgressRing percent={setup.percent} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-extrabold text-ink">
                  Profile setup incomplete — {setup.items.filter((i) => i.done).length} of{" "}
                  {setup.items.length} sections
                </span>
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
                      onClick={() => setModal(item.key === "parents" ? "invite" : "edit")}
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
                onClick={() => setModal("edit")}
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
                  {a}
                </span>
              ))}
              <button
                type="button"
                onClick={() => setModal("edit")}
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
                disabled
                title="Parents authorize medications from their app — you'll see them here"
                className="cursor-default text-[12.5px] font-bold text-faint"
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
                {medications.map((m) => (
                  <div key={m.id} className="grid grid-cols-[1.4fr_1.2fr_1fr_.8fr] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0">
                    <span className="text-[12.5px] font-bold text-ink">
                      {m.name} {m.dosage}
                    </span>
                    <span className="text-[12.5px] text-muted">{m.schedule ?? "—"}</span>
                    <span className="text-[12.5px] text-muted">{m.parent?.full_name ?? "—"}</span>
                    <span>
                      {m.active ? (
                        <span className="rounded-full bg-[#E4F3EC] px-2.5 py-[3px] text-[11px] font-bold text-success">
                          Active
                        </span>
                      ) : (
                        <span className="rounded-full bg-canvas px-2.5 py-[3px] text-[11px] font-bold text-faint">
                          Ended
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

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
                <div className={`grid grid-cols-[1.4fr_1fr_.6fr_.8fr_60px] gap-2 border-b border-[#EDF3FB] pb-2 ${th}`}>
                  <span>NAME</span>
                  <span>RELATION</span>
                  <span>PIN</span>
                  <span>STATUS</span>
                  <span />
                </div>
                {child.guardians
                  .filter((g) => g.parent && g.pickup_authorized)
                  .map((g) => (
                    <div key={g.parent!.id} className="grid grid-cols-[1.4fr_1fr_.6fr_.8fr_60px] items-center gap-2 border-b border-[#EDF3FB] py-2.5">
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
                  <div key={p.id} className="grid grid-cols-[1.4fr_1fr_.6fr_.8fr_60px] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0">
                    <span className="flex items-center gap-2">
                      <Avatar name={p.full_name} size={26} />
                      <span className="text-[12.5px] font-bold text-ink">{p.full_name}</span>
                    </span>
                    <span className="text-[12.5px] text-muted">{p.relationship ?? "—"}</span>
                    <span className="font-mono text-[12px] font-semibold text-ink">{p.pin}</span>
                    <span>
                      <span className="rounded-full bg-[#E4F3EC] px-2.5 py-[3px] text-[11px] font-bold text-success">
                        Approved
                      </span>
                    </span>
                    <form action={removePickupAction}>
                      <input type="hidden" name="child_id" value={child.id} />
                      <input type="hidden" name="pickup_id" value={p.id} />
                      <button type="submit" className="text-[11.5px] font-bold text-danger hover:underline">
                        Remove
                      </button>
                    </form>
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
                      code <span className="font-mono font-semibold">{inv.code}</span> · invite sent
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
                onClick={() => setModal("edit")}
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
            </div>
            <p className="mt-2.5 text-[11.5px] text-faint">
              Attendance tracks day by day — recurring weekly schedules aren&apos;t
              built yet.
            </p>
          </section>

          <section className={card} aria-labelledby="consents-h">
            <h2 id="consents-h" className={`${cardTitle} mb-3`}>
              Consents &amp; documents
            </h2>
            {consents.length === 0 ? (
              <p className="text-[12.5px] text-faint">
                No consent records yet — parents grant them from their app.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {consents.map((c) => (
                  <div key={c.id} className="flex items-center gap-2.5">
                    <span className="flex-1 text-[12.5px] font-semibold text-ink">{c.kind}</span>
                    {c.granted ? (
                      <span className="text-[11.5px] font-bold text-success">Signed</span>
                    ) : (
                      <span className="text-[11.5px] font-bold text-warning-text">Request</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2.5 text-[11.5px] text-faint">
              File uploads land here with the document vault — next on the
              compliance roadmap.
            </p>
          </section>
        </div>
      </main>

      {modal === "edit" && (
        <EditChildModal child={child} classrooms={classrooms} onClose={() => setModal("none")} />
      )}
      {modal === "pickup" && (
        <PickupModal childId={child.id} childName={child.first_name} onClose={() => setModal("none")} />
      )}
      {modal === "invite" && (
        <InviteParentModal childId={child.id} childName={child.first_name} onClose={() => setModal("none")} />
      )}
      {modal === "setup" && (
        <SetupPanel
          childName={child.first_name}
          roomName={child.classroom?.name ?? null}
          setup={setup}
          onFix={(key) => setModal(key === "parents" ? "invite" : "edit")}
          onClose={() => setModal("none")}
        />
      )}
    </>
  );
}
