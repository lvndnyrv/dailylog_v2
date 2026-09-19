"use client";

import type { StaffDelegationRow, StaffRow } from "@dailylog/db/queries";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { dateInTimeZone } from "@/lib/center-date";
import {
  grantDelegationAction,
  revokeDelegationAction,
  type DelegationActionState,
} from "@/lib/staff/actions";

const AREA_OPTIONS = [
  { key: "attendance", label: "Attendance" },
  { key: "enrollment", label: "Enrollment" },
  { key: "compliance", label: "Compliance" },
  { key: "broadcasts", label: "Broadcasts" },
  { key: "billing", label: "Billing" },
] as const;

function addDays(value: Date, days: number): string {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateLabel(value: string, timeZone: string, includeYear = false): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
    timeZone,
  }).format(new Date(value));
}

function delegationIsActive(item: StaffDelegationRow): boolean {
  const now = new Date().getTime();
  return !item.revoked_at && new Date(item.starts_at).getTime() <= now && new Date(item.ends_at).getTime() > now;
}

function accessLabel(item: StaffDelegationRow): string {
  if (item.access_level === "full_admin") return "Full admin";
  return item.areas
    .map((area) => AREA_OPTIONS.find((option) => option.key === area)?.label ?? area)
    .join(" · ");
}

export function StaffDelegations({
  delegations,
  staff,
  timeZone,
  defaultDelegationDays,
}: {
  delegations: StaffDelegationRow[];
  staff: StaffRow[];
  timeZone: string;
  defaultDelegationDays: number;
}) {
  const [granting, setGranting] = useState(false);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const active = delegations.filter(delegationIsActive);
  const past = delegations.filter((item) => !delegationIsActive(item));
  const activeProfiles = new Set(active.map((item) => item.delegate_profile_id));
  const candidates = staff.filter(
    (member) =>
      member.profile &&
      member.profile.role === "educator" &&
      !activeProfiles.has(member.profile.id),
  );

  return (
    <div className="max-w-[760px] overflow-hidden rounded-[18px] border border-[rgba(23,51,91,.12)] bg-card shadow-[0_2px_12px_rgba(23,51,91,.08)]">
      <div className="flex items-center gap-3 border-b-[1.5px] border-[#EDF3FB] px-5 py-4">
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-extrabold text-ink">Delegated admin access</span>
          <span className="block text-[12px] text-faint">
            Grant a lead temporary admin powers with an expiry
          </span>
        </span>
        <button
          type="button"
          onClick={() => setGranting(true)}
          disabled={candidates.length === 0}
          className="whitespace-nowrap rounded-btn bg-primary px-4 py-2 text-[12.5px] font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Delegate admin
        </button>
      </div>

      <div className="flex flex-col gap-3 px-5 py-4">
        <span className="font-mono text-[10.5px] font-bold tracking-[.08em] text-faint">
          ACTIVE · {active.length}
        </span>
        {active.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[#D6E1F0] bg-[#F8FBFE] px-4 py-6 text-center text-[12.5px] text-muted">
            No one has temporary admin access right now.
          </div>
        ) : (
          active.map((item) => (
            <ActiveDelegation key={item.id} item={item} timeZone={timeZone} />
          ))
        )}

        <span className="mt-1 font-mono text-[10.5px] font-bold tracking-[.08em] text-faint">
          PAST
        </span>
        {past.length === 0 ? (
          <p className="px-1 text-[12px] text-faint">Past delegations will remain here as a record.</p>
        ) : (
          past.map((item) => {
            const endedBy = item.revoked_at
              ? `revoked${item.revoked_by_name ? ` by ${item.revoked_by_name}` : ""}`
              : "ended automatically";
            return (
              <div
                key={item.id}
                className="rounded-[12px] border border-[#EDF3FB] bg-[#F8FBFE] px-3.5 py-3"
              >
                <div className="flex items-center gap-3">
                  <Avatar name={item.delegate_name} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-ink">
                      {item.delegate_name} · {accessLabel(item)}
                    </span>
                    <span className="block text-[11.5px] text-faint">
                      {dateLabel(item.starts_at, timeZone)} – {dateLabel(item.revoked_at ?? item.ends_at, timeZone, true)} · {endedBy}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-expanded={openLog === item.id}
                    onClick={() => setOpenLog((current) => (current === item.id ? null : item.id))}
                    className="text-[11.5px] font-bold text-faint hover:text-primary"
                  >
                    Log
                  </button>
                </div>
                {openLog === item.id && (
                  <div className="mt-2 border-t border-[#E4ECF6] pt-2 text-[11.5px] text-muted">
                    {item.action_count} {item.action_count === 1 ? "action" : "actions"} attributed to {item.delegate_name} during this delegation.
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-5 py-3 text-[11.5px] leading-relaxed text-faint">
        Delegations never include billing or owner settings unless you add billing explicitly.
        All delegated actions stay attributed to the person.
      </div>

      {granting && (
        <GrantDelegationModal
          candidates={candidates}
          defaultDelegationDays={defaultDelegationDays}
          onClose={() => setGranting(false)}
        />
      )}
    </div>
  );
}

function ActiveDelegation({ item, timeZone }: { item: StaffDelegationRow; timeZone: string }) {
  const [state, action, pending] = useActionState<DelegationActionState, FormData>(
    revokeDelegationAction,
    {},
  );
  const today = dateInTimeZone(new Date(), timeZone);
  const endDay = dateInTimeZone(item.ends_at, timeZone);
  const days = Math.max(
    1,
    Math.round(
      (new Date(`${endDay}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) /
        86400000,
    ),
  );
  const scope = item.classroom_name ? `${item.classroom_name} rooms` : "assigned rooms";

  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border-[1.5px] border-[#E1D6F5] bg-[#F0EAFB] px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-white p-0.5">
          <Avatar name={item.delegate_name} size={34} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold text-ink">{item.delegate_name}</span>
          <span className="block truncate text-[12px] text-muted">
            {accessLabel(item)} · {scope}
          </span>
        </span>
        <form action={action}>
          <input type="hidden" name="delegation_id" value={item.id} />
          <button
            type="submit"
            disabled={pending}
            className="text-[12px] font-bold text-danger hover:underline disabled:opacity-50"
          >
            {pending ? "Revoking…" : "Revoke"}
          </button>
        </form>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-warning-bg px-2.5 py-1 text-[11px] font-bold text-warning-text">
          Expires {dateLabel(item.ends_at, timeZone)} · {days}d
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-muted">
          Granted by {item.granted_by_name}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-muted">
          {item.action_count} {item.action_count === 1 ? "action" : "actions"} logged
        </span>
      </div>
      {state.error && <p role="alert" className="text-[11.5px] font-semibold text-danger">{state.error}</p>}
    </div>
  );
}

function GrantDelegationModal({
  candidates,
  defaultDelegationDays,
  onClose,
}: {
  candidates: StaffRow[];
  defaultDelegationDays: number;
  onClose: () => void;
}) {
  const [accessLevel, setAccessLevel] = useState<"specific_areas" | "full_admin">(
    "specific_areas",
  );
  const [areas, setAreas] = useState<string[]>(["attendance", "enrollment"]);
  const [endsOn, setEndsOn] = useState(() => addDays(new Date(), defaultDelegationDays));
  const [state, action, pending] = useActionState<DelegationActionState, FormData>(
    grantDelegationAction,
    {},
  );
  const firstCandidate = useMemo(() => candidates[0]?.profile?.id ?? "", [candidates]);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const toggleArea = (area: string) => {
    setAreas((current) =>
      current.includes(area) ? current.filter((item) => item !== area) : [...current, area],
    );
  };

  return (
    <Modal onClose={onClose} width={460}>
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[19px] font-extrabold text-ink">Delegate admin powers</span>
          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">
            Temporary — it ends on its own at the expiry date.
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-8 flex-none place-items-center rounded-full bg-canvas text-muted hover:bg-[#E8EFF8]"
        >
          ×
        </button>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="access_level" value={accessLevel} />
        {accessLevel === "specific_areas" &&
          areas.map((area) => <input key={area} type="hidden" name="areas" value={area} />)}

        <label className="flex flex-col gap-1.5 text-[12.5px] font-bold text-ink">
          Staff member
          <select
            name="delegate_profile_id"
            required
            defaultValue={firstCandidate}
            className="rounded-[12px] border-[1.5px] border-[#D6E1F0] bg-[#F9FBFE] px-3.5 py-2.5 text-[13.5px] font-bold text-ink outline-none focus:border-[var(--primary)]"
          >
            {candidates.map((member) => (
              <option key={member.profile!.id} value={member.profile!.id}>
                {member.profile!.full_name}{member.profile!.classroom?.name ? ` · ${member.profile!.classroom.name}` : ""}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[12.5px] font-bold text-ink">Access level</legend>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              aria-pressed={accessLevel === "specific_areas"}
              onClick={() => setAccessLevel("specific_areas")}
              className={`rounded-[10px] py-2 text-[12.5px] font-bold ${
                accessLevel === "specific_areas"
                  ? "bg-primary text-white"
                  : "border-[1.5px] border-[#D6E1F0] bg-white text-body"
              }`}
            >
              Specific areas
            </button>
            <button
              type="button"
              aria-pressed={accessLevel === "full_admin"}
              onClick={() => setAccessLevel("full_admin")}
              className={`rounded-[10px] py-2 text-[12.5px] font-bold ${
                accessLevel === "full_admin"
                  ? "bg-primary text-white"
                  : "border-[1.5px] border-[#D6E1F0] bg-white text-body"
              }`}
            >
              Full admin
            </button>
          </div>
          {accessLevel === "specific_areas" ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {AREA_OPTIONS.map((option) => {
                const selected = areas.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleArea(option.key)}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${
                      selected
                        ? "bg-primary text-white"
                        : "border-[1.5px] border-[#D6E1F0] bg-white text-body"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
              Every console area in the person&apos;s assigned rooms, except billing and owner-only settings.
            </p>
          )}
        </fieldset>

        <label className="flex flex-col gap-1.5 text-[12.5px] font-bold text-ink">
          Ends on
          <input
            type="date"
            name="ends_on"
            required
            value={endsOn}
            min={addDays(new Date(), 1)}
            onChange={(event) => setEndsOn(event.target.value)}
            className="rounded-[12px] border-[1.5px] border-[#D6E1F0] bg-[#F9FBFE] px-3.5 py-2.5 text-[13.5px] font-bold text-ink outline-none focus:border-[var(--primary)]"
          />
          <span className="flex gap-1.5 pt-0.5">
            {[7, defaultDelegationDays].filter((days, index, values) => values.indexOf(days) === index).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setEndsOn(addDays(new Date(), days))}
                className={`rounded-full px-3 py-1 text-[11.5px] font-bold ${
                  endsOn === addDays(new Date(), days)
                    ? "bg-ink text-white"
                    : "border-[1.5px] border-[#D6E1F0] bg-white text-body"
                }`}
              >
                {days === 7 ? "1 week" : days === 14 ? "2 weeks" : `${days} days`}
              </button>
            ))}
            <span className="rounded-full border-[1.5px] border-[#D6E1F0] bg-white px-3 py-1 text-[11.5px] font-bold text-body">
              Custom
            </span>
          </span>
        </label>

        <div className="rounded-[14px] border-[1.5px] border-[#EFD9B5] bg-warning-bg px-[15px] py-3 text-[12px] leading-relaxed text-[#8A6A2E]">
          Actions this person takes as a delegate are attributed to them and written to the audit log. You can revoke access at any time.
        </div>

        {state.error && <Notice tone="error">{state.error}</Notice>}

        <div className="flex justify-end gap-2.5 pt-0.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-white px-5 py-2.5 text-[13px] font-bold text-ink hover:bg-canvas"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || (accessLevel === "specific_areas" && areas.length === 0)}
            className="rounded-btn bg-primary px-5 py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Granting…" : "Grant access"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
