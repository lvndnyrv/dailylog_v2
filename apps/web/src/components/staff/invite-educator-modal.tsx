"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { inviteStaffAction, type StaffActionState } from "@/lib/staff/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

type RoleChip = "educator" | "lead" | "admin";

const ROLE_OPTIONS: { value: RoleChip; label: string }[] = [
  { value: "educator", label: "Educator" },
  { value: "lead", label: "Lead educator" },
  { value: "admin", label: "Delegated admin" },
];

const ROLE_BLURBS: Record<RoleChip, { name: string; blurb: string }> = {
  educator: {
    name: "Educator",
    blurb:
      "assigned-room logs, attendance and incident filing. No billing, enrollment or staff access.",
  },
  lead: {
    name: "Lead educator",
    blurb:
      "everything an educator has, plus room oversight. No billing, enrollment or staff access.",
  },
  admin: {
    name: "Delegated admin",
    blurb: "full console access within this center. Only the owner can change admin roles.",
  },
};

// Invite educator 4f — role, rooms & starting permissions. The server queues
// email delivery and keeps the link visible as a manual fallback.
export function InviteEducatorModal({
  classrooms,
  onClose,
}: {
  classrooms: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<StaffActionState, FormData>(
    inviteStaffAction,
    {},
  );
  const [role, setRole] = useState<RoleChip>("educator");
  const [room, setRoom] = useState<string>("floater");
  const [bgCheck, setBgCheck] = useState(true);
  const [copied, setCopied] = useState(false);

  const chip = (active: boolean, dashed = false) =>
    `cursor-pointer rounded-full px-[15px] py-2 text-[13px] font-bold ${
      active
        ? "bg-primary text-white"
        : `${dashed ? "border-dashed" : ""} border-[1.5px] border-[#D6E1F0] bg-card text-ink hover:bg-canvas`
    }`;

  return (
    <Modal onClose={onClose} width={468}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-ink">Invite educator</h2>
          <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
            They&apos;ll use the link to set up their account and upload certs.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-8 flex-none place-items-center rounded-full bg-canvas text-[13px] text-muted hover:text-ink"
        >
          ✕
        </button>
      </div>

      {state.ok && state.inviteLink ? (
        <>
          <Notice tone="success">
            <b>Invite created.</b>{" "}
            {state.emailQueued
              ? "Email queued for delivery. The link works once and expires in 14 days."
              : "Email could not be queued; send this one-time link manually."}
          </Notice>
          <div className="flex items-center gap-2 rounded-[13px] bg-canvas px-3.5 py-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
              {state.inviteLink}
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(state.inviteLink!);
                setCopied(true);
              }}
              className="whitespace-nowrap rounded-btn border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-xs font-bold text-primary hover:bg-card"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <Field label="Full name" name="full_name" placeholder="e.g. Sam Porter" required />
          <Field label="Email" name="email" type="email" placeholder="name@email.com" required />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-bold text-ink">Role</legend>
            <input type="hidden" name="role" value={role} />
            <div className="flex gap-2">
              {ROLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={role === option.value}
                  onClick={() => setRole(option.value)}
                  className={`flex-1 whitespace-nowrap rounded-[13px] border-[1.5px] px-2 py-3 text-center text-[13.5px] font-bold ${
                    role === option.value
                      ? "border-[var(--primary)] bg-primary text-white"
                      : "border-[#D6E1F0] bg-card text-ink hover:bg-canvas"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-bold text-ink">Rooms</legend>
            <input
              type="hidden"
              name="classroom_id"
              value={room === "floater" || role === "admin" ? "" : room}
            />
            <div className="flex flex-wrap gap-1.5">
              {classrooms.map((classroom) => (
                <button
                  key={classroom.id}
                  type="button"
                  aria-pressed={room === classroom.id}
                  onClick={() => setRoom(classroom.id)}
                  className={chip(room === classroom.id)}
                >
                  {classroom.name}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={room === "floater"}
                onClick={() => setRoom("floater")}
                className={chip(room === "floater", true)}
              >
                Floater
              </button>
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5 rounded-[13px] bg-canvas px-3.5 py-3">
            <p className="text-[12.5px] leading-normal text-muted">
              Starts with the <b className="text-ink">{ROLE_BLURBS[role].name}</b>{" "}
              role&apos;s defaults — {ROLE_BLURBS[role].blurb}
            </p>
            <Link
              href="/staff?tab=roles"
              className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
            >
              Preview permissions →
            </Link>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-[13px] border-[1.5px] border-[#EDF3FB] px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold text-ink">
                Require background check first
              </span>
              <span className="block text-[11.5px] text-faint">
                Not schedulable until it clears
              </span>
            </span>
            <input
              type="checkbox"
              name="require_background_check"
              checked={bgCheck}
              onChange={(e) => setBgCheck(e.target.checked)}
              className="peer sr-only"
            />
            <span
              className={`relative h-[24px] w-[42px] flex-none rounded-full transition-colors ${
                bgCheck ? "bg-success" : "bg-[#D6E1F0]"
              }`}
              aria-hidden
            >
              <span
                className={`absolute top-[3px] size-[18px] rounded-full bg-white transition-all ${
                  bgCheck ? "right-[3px]" : "left-[3px]"
                }`}
              />
            </span>
          </label>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="secondary" className="px-6 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="px-6 py-3 text-sm" disabled={pending}>
              {pending ? "Creating…" : "Send invite"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
