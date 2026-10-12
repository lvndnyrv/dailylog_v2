"use server";

import { redirect } from "next/navigation";

import { trustedRequestOrigin } from "@/lib/auth/trusted-origin";
import { getServerSupabase } from "@/lib/supabase/server";

export interface AccountDeletionState {
  error?: string;
  sent?: boolean;
  requested?: boolean;
}

export async function requestAccountDeletionLinkAction(
  _previous: AccountDeletionState,
  formData: FormData,
): Promise<AccountDeletionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { error: "Enter the email used for your DailyLog account." };

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email?.toLowerCase() === email) redirect("/account-deletion/confirm");

  const origin = await trustedRequestOrigin();
  if (!origin) return { error: "The secure request link could not be created. Refresh and try again." };

  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", "/account-deletion/confirm");
  await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callback.toString(), shouldCreateUser: false },
  });

  // Do not reveal whether an address has a DailyLog account.
  return { sent: true };
}

export async function submitAccountDeletionAction(
  _previous: AccountDeletionState,
  formData: FormData,
): Promise<AccountDeletionState> {
  if (formData.get("confirm") !== "yes") {
    return { error: "Confirm that you want DailyLog to review this account for deletion." };
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your verification link expired. Request a new secure link." };

  // The generated database types are refreshed after this migration is linked.
  const { error } = await supabase.rpc("request_my_account_deletion" as never);
  if (error) {
    return { error: "Your deletion request could not be submitted. Wait a moment and try again." };
  }
  return { requested: true };
}
