import { BrandMark } from "@/components/brand";
import { signOutAction } from "@/lib/auth/actions";

export default function SignOutErrorPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-6">
      <section className="w-full max-w-md rounded-[22px] border border-hairline bg-card p-7 shadow-[0_14px_40px_rgba(23,51,91,.12)]">
        <BrandMark size="sm" />
        <h1 className="mt-6 text-xl font-extrabold text-ink">Sign-out needs another try</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          We couldn&apos;t confirm that your session ended. It may still be active on this browser.
          Please try again before leaving a shared device.
        </p>
        <form action={signOutAction} className="mt-6">
          <button type="submit" className="w-full rounded-btn bg-danger px-4 py-3 text-sm font-bold text-white hover:brightness-95">
            Try signing out again
          </button>
        </form>
        <a href="/dashboard" className="mt-3 block text-center text-sm font-semibold text-primary">
          Return to the dashboard
        </a>
      </section>
    </main>
  );
}
