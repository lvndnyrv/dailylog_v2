"use client";

import { Check, LockKeyhole, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { updateProfileAction, type ActionState } from "@/lib/auth/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function defaultDisplayName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function maskedPhone(phone: string | null): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length >= 4 ? `Text to ••• ••• ${digits.slice(-4)}` : null;
}

// Admin profile modal 14d — mirrors the handoff while reflecting real account
// state instead of hard-coding the example's photo and enabled MFA status.
export function ProfileModal({
  profile,
  daycareName,
  onClose,
}: {
  profile: {
    full_name: string;
    display_name: string | null;
    email: string;
    role: string;
    phone: string | null;
    avatar_url: string | null;
    mfa_enabled: boolean;
  };
  daycareName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string>();
  const [photoError, setPhotoError] = useState<string>();
  const [securityOpen, setSecurityOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateProfileAction,
    {},
  );

  const roleLabel = profile.role === "owner_admin" ? "Owner admin" : "Admin";
  const phoneLabel = maskedPhone(profile.phone);
  const mfaDescription = profile.mfa_enabled
    ? `${phoneLabel ?? "A verified second factor"} protects this account.`
    : "No second factor is enrolled for this account.";

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [avatarPreviewUrl]);

  useEffect(() => {
    if (!state.sent) return;
    router.refresh();
    onClose();
  }, [onClose, router, state.sent]);

  function previewPhoto(file: File) {
    setPhotoError(undefined);
    if (!AVATAR_TYPES.has(file.type)) {
      setPhotoError("Choose a JPG, PNG, or WebP image.");
      if (fileRef.current) fileRef.current.value = "";
      setAvatarPreviewUrl(undefined);
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setPhotoError("Choose an image smaller than 5 MB.");
      if (fileRef.current) fileRef.current.value = "";
      setAvatarPreviewUrl(undefined);
      return;
    }
    setAvatarPreviewUrl(URL.createObjectURL(file));
  }

  return (
    <Modal onClose={pending ? () => undefined : onClose}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Your profile</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          How other admins see you, and how you sign in. Separate from the center profile.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-[#D6E1F0] bg-canvas px-3.5 py-3">
        <Avatar name={profile.full_name} src={avatarPreviewUrl ?? profile.avatar_url} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-bold text-ink">{profile.full_name}</span>
          <span className="block truncate text-[11.5px] text-muted">
            {roleLabel} · {daycareName}
          </span>
        </span>
        <button
          type="button"
          className="flex-none text-[12px] font-bold text-primary hover:text-primary-hover disabled:opacity-60"
          onClick={() => fileRef.current?.click()}
          disabled={pending}
        >
          Change photo
        </button>
        <input
          ref={fileRef}
          form="admin-profile-form"
          name="avatar"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Choose profile photo"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) previewPhoto(file);
          }}
        />
      </div>

      {photoError && <Notice tone="error">{photoError}</Notice>}
      {avatarPreviewUrl && (
        <Notice tone="info">
          Photo ready — <b>Save profile</b> applies it; <b>Cancel</b> discards it.
        </Notice>
      )}

      <form id="admin-profile-form" action={action} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink">Full name</span>
            <input
              name="full_name"
              defaultValue={profile.full_name}
              required
              className="min-w-0 rounded-xl border-[1.5px] border-[#D6E1F0] bg-card px-[13px] py-[11px] text-[13.5px] text-ink outline-none focus:border-primary"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink">Display name</span>
            <input
              name="display_name"
              defaultValue={profile.display_name ?? defaultDisplayName(profile.full_name)}
              required
              maxLength={60}
              className="min-w-0 rounded-xl border-[1.5px] border-[#D6E1F0] bg-card px-[13px] py-[11px] text-[13.5px] text-ink outline-none focus:border-primary"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-ink">Work email · used to sign in</span>
          <span className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-[#D6E1F0] bg-card px-[13px] py-[11px]">
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{profile.email}</span>
            <span className="rounded-full bg-[#E4F3EC] px-[9px] py-[3px] text-[10.5px] font-bold text-success">
              Verified
            </span>
          </span>
        </label>

        <div className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-[#EDF3FB] bg-card px-[13px] py-[11px]">
          <LockKeyhole size={15} strokeWidth={1.7} className="flex-none text-muted" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-bold text-ink">Password</span>
            <span className="block text-[11.5px] text-muted">Changed through a secure email link</span>
          </span>
          <a href="/forgot" className="text-[12.5px] font-bold text-primary hover:text-primary-hover">
            Change
          </a>
        </div>

        <div className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-[#EDF3FB] bg-card px-[13px] py-[11px]">
          {profile.mfa_enabled ? (
            <Check size={15} strokeWidth={1.9} className="flex-none text-success" aria-hidden />
          ) : (
            <Shield size={15} strokeWidth={1.7} className="flex-none text-muted" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-bold text-ink">
              Two-step verification · {profile.mfa_enabled ? "on" : "off"}
            </span>
            <span className="block text-[11.5px] text-muted">{mfaDescription}</span>
          </span>
          <button
            type="button"
            className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
            onClick={() => setSecurityOpen((open) => !open)}
          >
            {profile.mfa_enabled ? "Manage" : "Set up"}
          </button>
        </div>

        {securityOpen && (
          <div className="rounded-xl border-[1.5px] border-[#D6E1F0] bg-canvas px-[13px] py-[11px] text-[11.5px] leading-normal text-muted">
            Two-step enrollment and recovery are completed in the dedicated account-security flow
            (design 10b). This row reports the live Supabase factor status.
          </div>
        )}

        {state.sent && (
          <Notice tone="success">
            <b>Profile saved.</b>
          </Notice>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}

        <div className="flex gap-2.5">
          <Button
            type="button"
            variant="secondary"
            className="flex-1 rounded-full py-[13px] text-sm"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" className="flex-1 rounded-full py-[13px] text-sm" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </form>

      <p className="text-center text-[11.5px] leading-normal text-faint">
        Profile changes are logged in the audit trail. Password changes use a secure emailed reset
        link.
      </p>
    </Modal>
  );
}
