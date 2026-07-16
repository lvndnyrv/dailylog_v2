"use client";

import type { PendingStaffInvite, StaffRow } from "@dailylog/db/queries";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { revokeInviteAction } from "@/lib/staff/actions";
import { InviteEducatorModal } from "./invite-educator-modal";

type Tab = "roster" | "roles";

const tabClass = (active: boolean) =>
  `border-b-[2.5px] py-[11px] text-[13px] ${
    active
      ? "border-[var(--primary)] font-bold text-primary"
      : "border-transparent font-semibold text-faint hover:text-muted"
  }`;

const lockedTab =
  "cursor-default border-b-[2.5px] border-transparent py-[11px] text-[13px] font-semibold text-[#C3D2E6]";

const HEAD = "font-bold text-[10.5px] tracking-[.07em] text-faint";

const ROLE_LABELS: Record<string, string> = {
  owner_admin: "Owner admin",
  admin: "Delegated admin",
  educator: "Educator",
};

// Read-only roles overview 4o (the permissions matrix 4e is Phase 5).
const ROLES_OVERVIEW = [
  {
    role: "Owner admin",
    who: "The center owner — Amara in the seed",
    can: "Everything: billing, enrollment, staff, settings, and every room.",
  },
  {
    role: "Delegated admin",
    who: "A trusted lead with admin powers",
    can: "Same console access within the center; only the owner can change admin roles.",
  },
  {
    role: "Educator",
    who: "Room staff on the mobile app",
    can: "Assigned-room logs, attendance and incident filing. No billing, enrollment or staff access.",
  },
  {
    role: "Parent",
    who: "Families on the mobile app",
    can: "Their own children only: feed, messages, consents, absences.",
  },
];

export function StaffView({
  staff,
  invites,
  classrooms,
  openInvite,
  initialTab,
}: {
  staff: StaffRow[];
  invites: PendingStaffInvite[];
  classrooms: { id: string; name: string }[];
  openInvite: boolean;
  initialTab: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [roomFilter, setRoomFilter] = useState<string | null>(null);
  const [inviting, setInviting] = useState(openInvite);
  const router = useRouter();

  const filtered = roomFilter
    ? staff.filter((s) => s.profile?.classroom?.id === roomFilter)
    : staff;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-[22px] border-b-[1.5px] border-hairline bg-card px-7">
        <button type="button" className={tabClass(tab === "roster")} onClick={() => setTab("roster")}>
          Roster
        </button>
        <span className={lockedTab} title="Arrives in a later phase">
          Timesheets
        </span>
        <span className={lockedTab} title="Arrives in a later phase">
          Time off
        </span>
        <span className={lockedTab} title="Arrives in a later phase">
          Delegations
        </span>
        <button type="button" className={tabClass(tab === "roles")} onClick={() => setTab("roles")}>
          Roles
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setInviting(true)}
          className="my-2 rounded-btn bg-primary px-[18px] py-2 text-[13px] font-bold text-white hover:bg-primary-hover"
        >
          + Invite educator
        </button>
      </div>

      <div className="flex flex-col gap-3.5 px-7 pb-6 pt-[18px]">
        {tab === "roster" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Chip active={roomFilter === null} onClick={() => setRoomFilter(null)}>
                Everyone · {staff.length}
              </Chip>
              {classrooms.map((room) => (
                <Chip
                  key={room.id}
                  active={roomFilter === room.id}
                  onClick={() => setRoomFilter(room.id)}
                >
                  {room.name}
                </Chip>
              ))}
            </div>

            <div className="overflow-hidden rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card">
              <div className={`grid grid-cols-[1.8fr_1fr_1fr_1.4fr_.9fr_34px] gap-2.5 border-b-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3 ${HEAD}`}>
                <span>NAME</span>
                <span>ROLE</span>
                <span>ROOM</span>
                <span>CERTIFICATIONS</span>
                <span>STATUS</span>
                <span />
              </div>

              {filtered.map((member) => {
                const certs = member.certifications ?? [];
                return (
                  <div
                    key={member.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/staff/${member.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") router.push(`/staff/${member.id}`);
                    }}
                    className="grid cursor-pointer grid-cols-[1.8fr_1fr_1fr_1.4fr_.9fr_34px] items-center gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3 last:border-b-0 hover:bg-[#F8FBFE] focus-visible:bg-[#F8FBFE] focus-visible:outline-none"
                  >
                    <span className="flex items-center gap-2.5">
                      <Avatar name={member.profile!.full_name} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold text-ink">
                          {member.profile!.full_name}
                        </span>
                        {member.job_title && (
                          <span className="block truncate text-[11px] text-faint">
                            {member.job_title}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="text-[12.5px] text-muted">
                      {ROLE_LABELS[member.profile!.role] ?? member.profile!.role}
                    </span>
                    <span className="text-[12.5px] text-muted">
                      {member.profile!.classroom?.name ?? "—"}
                    </span>
                    <span className="text-[12.5px] text-muted">
                      {certs.length === 0 ? (
                        "—"
                      ) : (
                        <span className="text-success">
                          {certs.length} on file ✓
                        </span>
                      )}
                    </span>
                    <span>
                      <span className="rounded-full bg-[#E4F3EC] px-2.5 py-[3px] text-[11px] font-bold text-success">
                        Active
                      </span>
                    </span>
                    <span className="grid place-items-center text-[#C3D2E6]">›</span>
                  </div>
                );
              })}

              {/* Invite lifecycle rows (4d): pending / expired with resend & revoke */}
              {invites.map((invite) => {
                const expired = invite.expires_at && new Date(invite.expires_at) < new Date();
                return (
                  <div
                    key={invite.id}
                    className="grid grid-cols-[1.8fr_1fr_1fr_1.4fr_.9fr_34px] items-center gap-2.5 border-b border-[#EDF3FB] bg-[#FBFDFF] px-[18px] py-3 last:border-b-0"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="grid size-8 flex-none place-items-center rounded-full border-[1.5px] border-dashed border-[#C3D2E6] text-[11px] font-bold text-faint">
                        ?
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold text-ink">
                          {invite.email}
                        </span>
                        <span className="block font-mono text-[10.5px] text-faint">
                          code {invite.code}
                        </span>
                      </span>
                    </span>
                    <span className="text-[12.5px] text-muted">
                      {ROLE_LABELS[invite.role] ?? invite.role}
                    </span>
                    <span className="text-[12.5px] text-muted">{invite.classroom?.name ?? "—"}</span>
                    <span className="text-[12.5px] text-faint">Awaiting acceptance</span>
                    <span>
                      {expired ? (
                        <span className="rounded-full bg-danger-bg px-2.5 py-[3px] text-[11px] font-bold text-danger">
                          Expired
                        </span>
                      ) : (
                        <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[11px] font-bold text-warning-text">
                          Pending
                        </span>
                      )}
                    </span>
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="invite_id" value={invite.id} />
                      <button
                        type="submit"
                        title="Revoke invite"
                        className="text-[11.5px] font-bold text-danger hover:underline"
                      >
                        ✕
                      </button>
                    </form>
                  </div>
                );
              })}

              {filtered.length === 0 && invites.length === 0 && (
                <div className="px-6 py-10 text-center text-[12.5px] text-muted">
                  No staff yet — send the first invite.
                </div>
              )}
            </div>
          </>
        )}

        {tab === "roles" && (
          <div className="overflow-hidden rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card">
            <div className={`grid grid-cols-[1fr_1.2fr_2fr] gap-2.5 border-b-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3 ${HEAD}`}>
              <span>ROLE</span>
              <span>WHO</span>
              <span>WHAT THEY CAN DO</span>
            </div>
            {ROLES_OVERVIEW.map((r) => (
              <div
                key={r.role}
                className="grid grid-cols-[1fr_1.2fr_2fr] items-start gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3.5 last:border-b-0"
              >
                <span className="text-[13px] font-bold text-ink">{r.role}</span>
                <span className="text-[12.5px] text-muted">{r.who}</span>
                <span className="text-[12.5px] leading-relaxed text-body">{r.can}</span>
              </div>
            ))}
            <p className="border-t-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3 text-[11.5px] text-faint">
              Read-only in Phase 1 — the permissions matrix (4e) and per-person
              overrides arrive in Phase 5. Enforced today by row-level security.
            </p>
          </div>
        )}
      </div>

      {inviting && (
        <InviteEducatorModal classrooms={classrooms} onClose={() => setInviting(false)} />
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-[13px] py-1.5 text-xs ${
        active
          ? "bg-primary font-bold text-white"
          : "border-[1.5px] border-[#D6E1F0] bg-card font-semibold text-body hover:bg-canvas"
      }`}
    >
      {children}
    </button>
  );
}
