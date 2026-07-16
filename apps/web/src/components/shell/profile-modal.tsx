"use client";

import { useActionState } from "react";
import { updateProfileAction, type ActionState } from "@/lib/auth/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Admin profile modal 14d. Design's "Display name" field is omitted — the
// schema has one name (DECISIONS.md). Password changes ride the reset flow.
export function ProfileModal({
  profile,
  daycareName,
  onClose,
}: {
  profile: { full_name: string; email: string; role: string };
  daycareName: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateProfileAction,
    {},
  );

  return (
    <Modal onClose={onClose}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Your profile</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          How other admins see you, and how you sign in. Separate from the center
          profile.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-[#D6E1F0] bg-canvas px-3.5 py-3">
        <Avatar name={profile.full_name} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-bold text-ink">{profile.full_name}</span>
          <span className="block text-[11.5px] text-muted">
            {profile.role === "owner_admin" ? "Owner admin" : "Admin"} · {daycareName}
          </span>
        </span>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <Field label="Full name" name="full_name" defaultValue={profile.full_name} required />

        <label className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-bold text-ink">Work email · used to sign in</span>
          <span className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-[#D6E1F0] bg-card px-[13px] py-[11px]">
            <span className="flex-1 text-[13.5px] text-ink">{profile.email}</span>
            <span className="rounded-full bg-[#E4F3EC] px-[9px] py-[3px] text-[10.5px] font-bold text-success">
              Verified
            </span>
          </span>
        </label>

        <div className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-[#EDF3FB] bg-card px-[13px] py-[11px]">
          <span className="flex-1">
            <span className="block text-[12.5px] font-bold text-ink">Password</span>
            <span className="block text-[11.5px] text-muted">
              Change it via an emailed reset link
            </span>
          </span>
          <a href="/forgot" className="text-[12.5px] font-bold text-primary hover:text-primary-hover">
            Change
          </a>
        </div>

        {state.sent && (
          <Notice tone="success">
            <b>Saved.</b>
          </Notice>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}

        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
