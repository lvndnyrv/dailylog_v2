import Link from "next/link";

export function ComplianceAccessNotice() {
  return (
    <main className="m-7 max-w-xl rounded-2xl border border-hairline bg-white p-7">
      <h1 className="text-xl font-extrabold text-ink">
        Compliance access required
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Inspection packs combine staff, attendance, incident and reporting
        records. Your admin role needs view access to each area. Ask your owner
        administrator to review your role permissions.
      </p>
      <Link
        href="/dashboard"
        className="mt-5 inline-block text-sm font-bold text-primary"
      >
        ← Back to dashboard
      </Link>
    </main>
  );
}
