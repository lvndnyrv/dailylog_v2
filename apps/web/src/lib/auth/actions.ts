"use server";

import {
  acceptStaffInvite,
  getMyProfile,
  getStaffInvite,
  startCenter,
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
    await acceptStaffInvite(supabase, code);
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
  if (!centerName || !fullName) return { error: "Center name and your name are required." };
  if (password.length < 12) {
    return { error: "12+ characters — that's the only rule." };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) return { error: error.message };
  if (!data.session) {
    return {
      error:
        "Account created — confirm your email from your inbox, then sign in to finish setting up your center.",
    };
  }

  try {
    await startCenter(supabase, centerName);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the center." };
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

// 14d — the only self-editable profile field for now is the name; email and
// role changes are separate, audited flows.
export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!configured()) return NOT_CONFIGURED;
  const supabase = await getServerSupabase();

  const fullName = String(formData.get("full_name") ?? "").trim();
  if (fullName.length < 2) return { error: "Enter your name." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Signed out — sign in again." };

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { sent: true };
}
