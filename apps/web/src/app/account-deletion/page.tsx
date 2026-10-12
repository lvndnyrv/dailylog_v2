import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { BrandMark } from "@/components/brand";
import { AccountDeletionForm } from "./account-deletion-form";

export const metadata: Metadata = {
  title: "Request account deletion | DailyLog",
  description: "Verify and submit a DailyLog account deletion request.",
};

export default function AccountDeletionPage() {
  return (
    <main className="min-h-screen bg-canvas px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-[620px]">
        <header className="mb-8 flex items-center justify-between gap-4">
          <BrandMark size="sm" />
          <Link href="/privacy" className="text-sm font-bold text-primary hover:underline">Privacy policy</Link>
        </header>
        <section className="rounded-[24px] border border-[var(--card-border)] bg-card p-6 shadow-[var(--card-shadow)] sm:p-9">
          <div className="grid size-14 place-items-center rounded-full bg-danger-bg text-danger">
            <ShieldAlert aria-hidden="true" size={28} />
          </div>
          <h1 className="mt-5 text-3xl font-black tracking-[-0.02em] text-ink">Request account deletion</h1>
          <p className="mt-3 text-[15px] leading-7 text-body">
            First, verify the email connected to your DailyLog account. A center administrator
            then reviews identity, active access, and records that childcare or employment law
            requires the center to retain.
          </p>
          <AccountDeletionForm />
          <div className="mt-6 border-t border-hairline pt-5 text-[13px] leading-6 text-muted">
            <p><strong className="text-ink">What happens next?</strong> Your account stays active while the request is reviewed. Required safety, billing, tax, incident, attendance, and employment records may be retained or anonymized.</p>
            <p className="mt-2">Parents can also submit and track this request in the mobile app under <strong>Me → Privacy & data</strong>.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
