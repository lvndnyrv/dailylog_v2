import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { BrandMark } from "@/components/brand";

export const metadata: Metadata = {
  title: "Privacy Policy | DailyLog",
  description: "How DailyLog handles information for childcare centers and families.",
};

const sections = [
  {
    title: "Information DailyLog handles",
    paragraphs: [
      "Account and contact details such as names, email addresses, phone numbers, roles, and center membership.",
      "Childcare records such as child profiles and photos, attendance, daily care entries, allergies and medical instructions, incidents, authorized pickup people, enrollment documents, consents, and family-staff messages.",
      "Operational and billing records such as schedules, invoices, payment status, staff records, and compliance records. DailyLog also stores device push tokens and limited technical information needed to sign in, secure the app, and deliver notifications.",
    ],
  },
  {
    title: "How the information is used",
    paragraphs: [
      "Information is used to provide childcare communication and center operations, protect accounts, send requested notifications, support enrollment and billing, meet record-keeping obligations, and respond to privacy requests.",
      "DailyLog does not sell personal information, use it for third-party advertising, or track people across other companies' apps or websites.",
    ],
  },
  {
    title: "Photos, camera, calendar, and biometrics",
    paragraphs: [
      "Camera and photo-library access is used only when a user chooses to capture, scan, or attach an image. Calendar access is requested only when a user chooses to add a center closure or booked tour. Face ID and fingerprint checks stay on the user's device and are used only when app lock is enabled. DailyLog does not receive biometric data.",
    ],
  },
  {
    title: "Service providers and storage",
    paragraphs: [
      "DailyLog uses service providers to operate the app, including Supabase for authentication, database, and file storage, and Apple, Google, and Expo for app delivery and push notifications. These providers process information only to deliver the service.",
      "The currently connected Supabase project is hosted in the United States. Data is encrypted in transit. Access controls limit records by center, role, classroom, and family relationship.",
    ],
  },
  {
    title: "Retention and deletion",
    paragraphs: [
      "Records are retained according to the childcare center's policies and applicable childcare, tax, employment, safety, and legal requirements. A request to close an account does not automatically erase records the center is required to keep.",
      "When information is no longer required, the center can remove or anonymize it in line with its obligations.",
    ],
  },
  {
    title: "Your choices and rights",
    paragraphs: [
      "Depending on location, a person may ask to access, correct, export, or delete personal information, or withdraw an optional consent. Parents and guardians can start a request from Me → Privacy & data in the mobile app. Staff and administrators can contact their center administrator. Identity and legal retention requirements are checked before a request is completed.",
    ],
  },
  {
    title: "Children's privacy",
    paragraphs: [
      "A center must have appropriate authority and parent or guardian consent before it adds or shares a child's information. DailyLog is designed for authorized adults; it is not directed to children and does not allow children to create accounts.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-canvas px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-[760px]">
        <header className="mb-8 flex items-center justify-between gap-4">
          <BrandMark size="sm" />
          <div className="flex items-center gap-4"><Link href="/support" className="text-sm font-bold text-primary hover:underline">Support</Link><Link href="/sign-in" className="rounded-btn border border-hairline bg-card px-4 py-2 text-sm font-bold text-ink transition hover:border-primary hover:text-primary">Sign in</Link></div>
        </header>

        <section className="rounded-[24px] border border-[var(--card-border)] bg-card p-6 shadow-[var(--card-shadow)] sm:p-9">
          <div className="mb-4 grid size-14 place-items-center rounded-full bg-tint text-primary">
            <ShieldCheck aria-hidden="true" size={28} strokeWidth={2.2} />
          </div>
          <h1 className="text-3xl font-black tracking-[-0.02em] text-ink sm:text-4xl">
            Your family&apos;s information
          </h1>
          <p className="mt-2 text-sm font-bold text-faint">Privacy notice · Version 2026-10-09</p>
          <p className="mt-5 max-w-[650px] text-[15px] leading-7 text-body">
            DailyLog helps childcare centers, their staff, and authorized family members
            coordinate care. Children do not create or operate DailyLog accounts.
          </p>
        </section>

        <div className="mt-5 space-y-4">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-[20px] border border-[var(--card-border)] bg-card p-6 shadow-[var(--card-shadow)] sm:p-7"
            >
              <h2 className="text-lg font-black text-ink">{section.title}</h2>
              <div className="mt-3 space-y-3 text-[14.5px] leading-6 text-body">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>

        <aside className="mt-5 rounded-[18px] bg-tint p-5 text-sm leading-6 text-body">
          <strong className="text-ink">Questions or requests?</strong>{" "}
          Contact the childcare center that controls the records. Its contact details are
          available in the center profile and enrollment documents. You can also{" "}
          <Link href="/account-deletion" className="font-bold text-primary hover:underline">
            submit a verified account deletion request
          </Link>.
        </aside>

        <footer className="py-8 text-center text-xs text-faint">
          © {new Date().getFullYear()} DailyLog
        </footer>
      </div>
    </main>
  );
}
