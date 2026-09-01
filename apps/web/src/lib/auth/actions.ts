"use server";

import {
  acceptStaffInvite,
  checkCenterRegistrationCode,
  completeCenterSetup,
  getMyProfile,
  getStaffInvite,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { roleDestination } from "./redirect";

export interface ActionState {
  error?: string;
  sent?: boolean;
}

function configured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

const NOT_CONFIGURED: ActionState = {
  error: "Supabase isn't configured yet — add .env.local first.",
};

export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!configured()) return NOT_CONFIGURED;
  const supabase = await getServerSupabase();

  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
  if (error) {
    return { error: "That email and password don't match — try again." };
  }

  const profile = await getMyProfile(supabase);
  redirect(roleDestination(profile?.role));
}

// 10a's "Email me a one-time sign-in link" secondary path.
export async function magicLinkAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!configured()) return NOT_CONFIGURED;
  const supabase = await getServerSupabase();
  const origin = (await headers()).get("origin") ?? "";

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your work email first, then request the link." };

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/`, shouldCreateUser: false },
  });
  if (error) return { error: error.message };
  return { sent: true };
}

export async function forgotAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!configured()) return NOT_CONFIGURED;
  const supabase = await getServerSupabase();
  const origin = (await headers()).get("origin") ?? "";

  const { error } = await supabase.auth.resetPasswordForEmail(
    String(formData.get("email") ?? "").trim(),
    { redirectTo: `${origin}/reset` },
  );
  if (error) return { error: error.message };
  return { sent: true };
}

// The /reset page the recovery email lands on (design shows only the request
// side, 10c — see DECISIONS.md).
export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!configured()) return NOT_CONFIGURED;
  const supabase = await getServerSupabase();

  const password = String(formData.get("password") ?? "");
  if (password.length < 12) {
    return { error: "12+ characters — that's the only rule." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "The reset link expired or was already used — request a new one." };
  }
  redirect("/sign-in?reset=done");
}

export async function acceptInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!configured()) return NOT_CONFIGURED;
  const supabase = await getServerSupabase();

  const code = String(formData.get("code") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const termsAccepted = formData.get("terms_accepted") === "on";
  if (!termsAccepted) {
    return { error: "Accept the Staff Terms and confidentiality policy to continue." };
  }
  if (password.length < 12) {
    return { error: "12+ characters — that's the only rule." };
  }

  const {
    data: { user: existing },
  } = await supabase.auth.getUser();

  if (!existing) {
    // carry the invite's name into the new profile (handle_new_user reads it)
    const invite = await getStaffInvite(supabase, code).catch(() => null);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: invite?.full_name ?? "" } },
    });

    // Re-opening the link after the account exists (e.g. confirmed email, or a
    // second visit) falls back to signing in with the same password.
    const alreadyRegistered =
      error?.message.toLowerCase().includes("already registered") ||
      (!error && data.user && data.user.identities?.length === 0);
    if (alreadyRegistered) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        return { error: "This email already has an account — the password doesn't match it." };
      }
    } else if (error) {
      return { error: error.message };
    } else if (!data.session) {
      return {
        error:
          "Account created — confirm your email from your inbox, then open this invite link again.",
      };
    }
  }

  try {
    await acceptStaffInvite(supabase, code, termsAccepted);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invite could not be accepted." };
  }

  const profile = await getMyProfile(supabase);
  redirect(roleDestination(profile?.role));
}

export async function startCenterAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!configured()) return NOT_CONFIGURED;
  const supabase = await getServerSupabase();

  const centerName = String(formData.get("center_name") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const address = String(formData.get("address") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const registrationCode = String(formData.get("registration_code") ?? "").trim();
  if (!centerName || !fullName || !email || !address || !phone || !registrationCode) {
    return { error: "Complete every required field, including your registration code." };
  }
  if (password.length < 12) {
    return { error: "12+ characters — that's the only rule." };
  }

  let preview;
  try {
    preview = await checkCenterRegistrationCode(supabase, registrationCode, email);
  } catch {
    return { error: "We could not verify that registration code. Wait a moment and try again." };
  }
  if (!preview) {
    return {
      error: "That registration code is invalid, expired, already used, or belongs to another email.",
    };
  }
  if (preview.center_name.trim().toLowerCase() !== centerName.toLowerCase()) {
    return {
      error: `This code was issued for ${preview.center_name}. Use that approved center name.`,
    };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        center_registration_code: registrationCode,
        approved_center_name: preview.center_name,
      },
    },
  });
  if (error) return { error: error.message };
  if (!data.session) {
    return {
      error:
        "Account created — confirm your email, then finish the approved center setup in the DailyLog app.",
    };
  }

  try {
    await completeCenterSetup(supabase, {
      centerName: preview.center_name,
      address,
      phone,
      registrationCode,
    });
    await supabase.auth.updateUser({
      data: {
        center_registration_code: null,
        approved_center_name: null,
      },
    });
  } catch (err) {
    return {
      error: err instanceof Error
        ? err.message
        : "The approved center could not be created. Your code was not consumed; try again.",
    };
  }

  redirect("/dashboard");
}

export async function signOutAction(formData?: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const everywhere = formData?.get("everywhere") === "1";
  await supabase.auth.signOut({ scope: everywhere ? "global" : "local" });
  revalidatePath("/", "layout");
  redirect("/signed-out");
}

// 14d — visible identity fields are self-editable; email and role changes are
// separate, audited flows.
export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!configured()) return NOT_CONFIGURED;
  const supabase = await getServerSupabase();

  const fullName = String(formData.get("full_name") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  if (fullName.length < 2) return { error: "Enter your name." };
  if (displayName.length < 1 || displayName.length > 60) {
    return { error: "Enter a display name of 60 characters or fewer." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Signed out — sign in again." };

  const avatarEntry = formData.get("avatar");
  const avatar = typeof avatarEntry === "string" || !avatarEntry?.size ? null : avatarEntry;
  const avatarExtensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (avatar && !avatarExtensions[avatar.type]) {
    return { error: "Choose a JPG, PNG, or WebP image." };
  }
  if (avatar && avatar.size > 5 * 1024 * 1024) {
    return { error: "Choose an image smaller than 5 MB." };
  }

  let uploadedPath: string | null = null;
  let nextAvatarUrl: string | null = null;
  let previousAvatarUrl: string | null = null;

  if (avatar) {
    const { data: currentProfile, error: currentProfileError } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .single();
    if (currentProfileError) return { error: currentProfileError.message };
    previousAvatarUrl = currentProfile.avatar_url;

    uploadedPath = `${user.id}/avatar-${crypto.randomUUID()}.${avatarExtensions[avatar.type]}`;
    const { error: uploadError } = await supabase.storage
      .from("profile-avatars")
      .upload(uploadedPath, avatar, {
        cacheControl: "3600",
        contentType: avatar.type,
        upsert: false,
      });
    if (uploadError) return { error: uploadError.message };

    const { data } = supabase.storage.from("profile-avatars").getPublicUrl(uploadedPath);
    nextAvatarUrl = `${data.publicUrl}?v=${Date.now()}`;
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      display_name: displayName,
      ...(nextAvatarUrl ? { avatar_url: nextAvatarUrl } : {}),
    })
    .eq("id", user.id);
  if (error) {
    if (uploadedPath) {
      await supabase.storage.from("profile-avatars").remove([uploadedPath]);
    }
    return { error: error.message };
  }

  if (uploadedPath && previousAvatarUrl) {
    try {
      const marker = "/storage/v1/object/public/profile-avatars/";
      const pathname = new URL(previousAvatarUrl).pathname;
      const markerIndex = pathname.indexOf(marker);
      const previousPath =
        markerIndex >= 0 ? decodeURIComponent(pathname.slice(markerIndex + marker.length)) : null;
      if (previousPath?.startsWith(`${user.id}/`) && previousPath !== uploadedPath) {
        await supabase.storage.from("profile-avatars").remove([previousPath]);
      }
    } catch {
      // The profile is already saved; an unrecognized legacy URL is safe to
      // leave in storage and can be cleaned up separately.
    }
  }

  revalidatePath("/", "layout");
  return { sent: true };
}
