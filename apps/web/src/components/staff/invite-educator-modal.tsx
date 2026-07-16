"use client";

import { useActionState, useState } from "react";
import { inviteStaffAction, type StaffActionState } from "@/lib/staff/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Invite educator 4f → the 10d accept flow. Email delivery is a later phase;
// the invite link is shown here to send along (DECISIONS.md). The design's
// "Require background check first" toggle waits for compliance (Phase 5).
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
  const [role, setRole] = useState("educator");
  const [copied, setCopied] = useState(false);

  return (
    <Modal onClose={onClose} width={468}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Invite educator</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          They&apos;ll use the link to set up their account and land in the roster.
        </p>
      </div>

      {state.ok && state.inviteLink ? (
        <>
          <Notice tone="success">
            <b>Invite created.</b> Send them this link — it works once and expires
            in 14 days.
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

          <fieldset className="flex flex-col gap-[7px]">
            <legend className="text-[13px] font-bold text-ink">Role</legend>
            <div className="flex gap-2">
              {[
                { value: "educator", label: "Educator" },
                { value: "admin", label: "Delegated admin" },
              ].map((option) => (
                <label
                  key={option.value}
                  className={`flex-1 cursor-pointer rounded-[13px] border-[1.5px] px-3 py-2.5 text-center text-[13px] font-bold ${
                    role === option.value
                      ? "border-[var(--primary)] bg-[#E7F0FB] text-primary"
                      : "border-[#D6E1F0] text-body hover:bg-canvas"
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={option.value}
                    checked={role === option.value}
                    onChange={() => setRole(option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          {role === "educator" && (
            <label className="flex flex-col gap-[7px]">
              <span className="text-[13px] font-bold text-ink">Room</span>
              <select
                name="classroom_id"
                defaultValue=""
                className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none focus:border-primary"
              >
                <option value="">Assign later</option>
                {classrooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <p className="rounded-[13px] bg-canvas px-3.5 py-3 text-[11.5px] leading-normal text-muted">
            Starts with the <b className="text-ink">{role === "educator" ? "Educator" : "Delegated admin"}</b>{" "}
            role&apos;s defaults —{" "}
            {role === "educator"
              ? "assigned-room logs, attendance and incident filing. No billing, enrollment or staff access."
              : "full console access within this center. Only the owner can change admin roles."}
          </p>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Creating…" : "Create invite"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
