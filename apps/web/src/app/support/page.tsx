import type { Metadata } from "next";
import Link from "next/link";
import { CircleHelp, KeyRound, ShieldCheck, Smartphone } from "lucide-react";

import { BrandMark } from "@/components/brand";

export const metadata: Metadata = {
  title: "Support | DailyLog",
  description: "Get help with DailyLog accounts, childcare records, and the mobile app.",
};

const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();

const topics = [
  { icon: KeyRound, title: "Sign-in or invitation help", body: "Use Forgot password on the sign-in screen. If an invitation or family link expired, ask your childcare center to send a new one." },
  { icon: ShieldCheck, title: "Child, billing, or privacy records", body: "Your childcare center controls these records. Contact its administrator using the details in your enrollment documents or center profile." },
  { icon: Smartphone, title: "App problem", body: "Confirm you are online, install the latest DailyLog update, close and reopen the app, then try again. Include your app version and the time of the problem when asking for help." },
];

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-canvas px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-[720px]">
        <header className="mb-8 flex items-center justify-between gap-4">
          <BrandMark size="sm" />
          <Link href="/sign-in" className="rounded-btn border border-hairline bg-card px-4 py-2 text-sm font-bold text-ink hover:border-primary hover:text-primary">Sign in</Link>
        </header>
        <section className="rounded-[24px] border border-[var(--card-border)] bg-card p-6 shadow-[var(--card-shadow)] sm:p-9">
          <div className="grid size-14 place-items-center rounded-full bg-tint text-primary"><CircleHelp aria-hidden="true" size={29} /></div>
          <h1 className="mt-5 text-3xl font-black tracking-[-0.02em] text-ink sm:text-4xl">How can we help?</h1>
          <p className="mt-3 max-w-[590px] text-[15px] leading-7 text-body">Start with the path that matches your problem. Never include a password, pickup PIN, payment card number, or a child&apos;s medical document in a support message.</p>
        </section>

        <div className="mt-5 space-y-4">
          {topics.map(({ icon: Icon, title, body }) => (
            <section key={title} className="flex gap-4 rounded-[20px] border border-[var(--card-border)] bg-card p-6 shadow-[var(--card-shadow)]">
              <div className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-tint text-primary"><Icon aria-hidden="true" size={22} /></div>
              <div><h2 className="font-black text-ink">{title}</h2><p className="mt-1 text-sm leading-6 text-body">{body}</p></div>
            </section>
          ))}
        </div>

        <section className="mt-5 rounded-[20px] border border-[var(--card-border)] bg-card p-6 shadow-[var(--card-shadow)]">
          <h2 className="text-lg font-black text-ink">Still need help?</h2>
          {supportEmail ? (
            <p className="mt-2 text-sm leading-6 text-body">Email <a className="font-bold text-primary hover:underline" href={`mailto:${supportEmail}`}>{supportEmail}</a>. Include your account email, center name, device type, app version, and a short description—never your password.</p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-body">Contact your childcare center administrator. Technical support contact details will also appear here once configured for the production release.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold text-primary"><Link href="/privacy" className="hover:underline">Privacy policy</Link><Link href="/account-deletion" className="hover:underline">Account deletion request</Link></div>
        </section>
      </div>
    </main>
  );
}
