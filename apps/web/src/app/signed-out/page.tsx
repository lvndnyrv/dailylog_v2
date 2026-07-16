import { BrandMark } from "@/components/brand";

// Signed-out landing 14c. The design greets by name; the session is gone at
// this point, so the copy stays generic rather than passing a name through
// the URL (DECISIONS.md).
export default function SignedOutPage() {
  return (
    <main className="flex min-h-screen bg-card">
      <div className="flex flex-1 flex-col justify-center gap-[22px] px-[88px] py-12">
        <BrandMark />
        <div className="flex items-center gap-[11px] self-start rounded-[13px] border-[1.5px] border-[#BFE3D0] bg-[#E4F3EC] px-[15px] py-3">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
              d="M3.5 10.5L8 15l8.5-9"
              stroke="var(--success)"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[12.5px] font-semibold text-ink">You&apos;re signed out.</span>
        </div>
        <div className="max-w-[460px]">
          <h1 className="text-[32px] font-extrabold leading-tight text-ink">
            See you tomorrow.
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Anyone using this browser will need to sign in again. If this
            isn&apos;t your device, sign back in and end every session from the
            account menu.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <a
            href="/sign-in"
            className="rounded-btn bg-primary px-[22px] py-3.5 text-sm font-bold text-white hover:bg-primary-hover"
          >
            Sign back in
          </a>
          <a
            href="/start"
            className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-5 py-[13px] text-[13.5px] font-bold text-ink hover:bg-canvas"
          >
            Switch center
          </a>
        </div>
        <p className="max-w-[440px] text-[11.5px] leading-relaxed text-faint">
          Educators and families sign out from their own apps — this page is for
          admins.
        </p>
      </div>

      <div className="relative hidden w-[480px] flex-none flex-col justify-center gap-[22px] overflow-hidden bg-ink px-[60px] lg:flex">
        <span className="absolute -right-[90px] -top-[90px] size-[320px] rounded-full bg-warning/15" />
        <span className="absolute -bottom-[60px] -left-[60px] size-[220px] rounded-full bg-primary/20" />
        <span className="relative font-mono text-[11px] font-bold tracking-[.08em] text-warning">
          WHILE YOU&apos;RE AWAY
        </span>
        <div className="relative flex flex-col gap-3.5">
          {[
            "Educators keep logging the day from their app",
            "Families keep their feed and messages",
            "Everything is waiting when you sign back in",
          ].map((line) => (
            <span key={line} className="flex items-center gap-[11px] text-sm text-[#C9DAF0]">
              <span className="size-2 flex-none rounded-full bg-[#7FCB9F]" />
              {line}
            </span>
          ))}
        </div>
        <p className="relative max-w-[330px] text-xs leading-relaxed text-faint">
          The console keeps running for the educators &amp; families on their
          apps — nothing pauses when you sign out.
        </p>
      </div>
    </main>
  );
}
