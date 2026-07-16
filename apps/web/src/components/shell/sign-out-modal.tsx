"use client";

import { useState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";

// Sign-out confirmation 14b. Device list arrives with the sessions feature —
// this ships the confirm + "end every session" toggle.
export function SignOutModal({
  profile,
  daycareName,
  onClose,
}: {
  profile: { full_name: string; email: string; role: string };
  daycareName: string;
  onClose: () => void;
}) {
  const [everywhere, setEverywhere] = useState(false);

  return (
    <Modal onClose={onClose}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Sign out of DailyLog?</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Anything you&apos;ve saved stays. Anything unsaved on this browser is dropped.
        </p>
      </div>

      <div className="flex items-center gap-[11px] rounded-[14px] border-[1.5px] border-[#D6E1F0] bg-canvas px-4 py-3.5">
        <Avatar name={profile.full_name} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-ink">
            {profile.full_name} · {profile.role === "owner_admin" ? "Owner admin" : "Admin"}
          </span>
          <span className="block text-[11.5px] text-muted">{daycareName}</span>
        </span>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5">
        <span className="flex-1">
          <span className="block text-[13px] font-bold text-ink">
            Sign out of every device too
          </span>
          <span className="block text-[11.5px] text-muted">
            Ends every session — useful on a shared or lost device.
          </span>
        </span>
        <input
          type="checkbox"
          checked={everywhere}
          onChange={(e) => setEverywhere(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${
            everywhere ? "bg-primary" : "bg-[#D6E1F0]"
          }`}
          aria-hidden
        >
          <span
            className={`absolute top-0.5 size-[18px] rounded-full bg-white transition-all ${
              everywhere ? "right-0.5" : "left-0.5"
            }`}
          />
        </span>
      </label>

      <form action={signOutAction} className="flex gap-2.5">
        {everywhere && <input type="hidden" name="everywhere" value="1" />}
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-sm font-bold text-ink hover:bg-canvas"
        >
          Stay signed in
        </button>
        <button
          type="submit"
          className="flex-1 rounded-btn bg-danger px-4 py-3 text-sm font-bold text-white hover:brightness-95"
        >
          Sign out
        </button>
      </form>
    </Modal>
  );
}
