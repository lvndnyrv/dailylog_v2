import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRoundCheck } from "lucide-react";

import { BrandMark } from "@/components/brand";
import { getServerSupabase } from "@/lib/supabase/server";
import { AccountDeletionConfirmForm } from "./account-deletion-confirm-form";

export default async function AccountDeletionConfirmPage() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account-deletion?link=expired");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role, archived_at")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="min-h-screen bg-canvas px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-[620px]">
        <header className="mb-8 flex items-center justify-between gap-4"><BrandMark size="sm" /><Link href="/privacy" className="text-sm font-bold text-primary hover:underline">Privacy policy</Link></header>
        <section className="rounded-[24px] border border-[var(--card-border)] bg-card p-6 shadow-[var(--card-shadow)] sm:p-9">
          <div className="grid size-14 place-items-center rounded-full bg-tint text-primary"><UserRoundCheck aria-hidden="true" size={28} /></div>
          <h1 className="mt-5 text-3xl font-black tracking-[-0.02em] text-ink">Account verified</h1>
          <p className="mt-3 text-[15px] leading-7 text-body">
            You are requesting review for <strong className="text-ink">{profile?.email ?? user.email}</strong>.
            Submitting this form creates a tracked request; it does not erase records immediately.
          </p>
          {profile?.archived_at ? (
            <p className="mt-6 rounded-xl bg-warning-bg p-4 text-sm leading-6 text-warning-text">This account is already inactive. Contact the childcare center for retained-record questions.</p>
          ) : profile ? <AccountDeletionConfirmForm /> : (
            <p className="mt-6 rounded-xl bg-danger-bg p-4 text-sm leading-6 text-danger">This verified login is not linked to an active DailyLog profile. Contact the childcare center that invited you.</p>
          )}
        </section>
      </div>
    </main>
  );
}
