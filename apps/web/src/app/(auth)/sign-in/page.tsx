import { BrandMark } from "@/components/brand";
import { SignInForm } from "./sign-in-form";

// Screen 10a — split layout: 530px form panel + ink brand panel.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; next?: string }>;
}) {
  const { reset, next } = await searchParams;
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  return (
    <main className="flex min-h-screen bg-card">
      <div className="flex w-full max-w-[530px] flex-none flex-col justify-center gap-[22px] px-[72px] py-12">
        <BrandMark />
        <div>
          <h1 className="text-[26px] font-extrabold text-ink">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">
            Sign in to your center&apos;s admin console.
          </p>
        </div>
        <SignInForm resetDone={reset === "done"} destination={destination} />
        <p className="text-[12.5px] leading-relaxed text-muted">
          New to DailyLog?{" "}
          <a href="/start" className="font-bold text-primary hover:text-primary-hover">
            Start your center →
          </a>
        </p>
      </div>

      <div className="relative hidden flex-1 flex-col justify-center gap-[26px] overflow-hidden bg-ink px-[76px] lg:flex">
        <span className="absolute -right-[90px] -top-[90px] size-[320px] rounded-full bg-warning/15" />
        <span
          className="absolute right-16 top-14 size-[74px] rounded-full bg-warning"
          style={{ boxShadow: "0 0 0 14px rgba(240,180,65,.18)" }}
        />
        <p className="max-w-[420px] text-[34px] font-extrabold leading-[1.25] text-white">
          Everything about today,
          <br />
          in one place.
        </p>
        <ul className="flex flex-col gap-3.5">
          {[
            "Ratios watched live, room by room",
            "Attendance signed and inspection-ready",
            "Billing that chases itself",
          ].map((line) => (
            <li key={line} className="flex items-center gap-[11px] text-[15px] text-[#C9DAF0]">
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path
                  d="M3.5 10.5L8 15l8.5-9"
                  stroke="var(--warning)"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {line}
            </li>
          ))}
        </ul>
        <p className="max-w-[400px] text-[12.5px] leading-relaxed text-faint">
          This console is for admins. Educators and families sign in from the
          DailyLog apps — nothing to remember, nothing to install here.
        </p>
      </div>
    </main>
  );
}
