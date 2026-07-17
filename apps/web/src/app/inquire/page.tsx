import { getPublicCenterInfo } from "@dailylog/db/queries";
import { BrandMark } from "@/components/brand";
import { getServerSupabase } from "@/lib/supabase/server";
import { InquiryForm } from "./inquiry-form";

// Public inquiry form 2g — family-facing, no sign-in. The shared link's
// center id scopes everything; the anon key + definer RPCs do the rest.
export default async function InquirePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c: daycareId } = await searchParams;

  const invalid = (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="flex w-[360px] max-w-full flex-col items-center gap-3 rounded-[28px] border border-[rgba(23,51,91,.12)] bg-card p-6 text-center"
        style={{ boxShadow: "0 14px 40px rgba(23,51,91,.16)" }}>
        <BrandMark size="sm" />
        <p className="text-[13px] leading-relaxed text-muted">
          This inquiry link isn&apos;t valid — please ask the center for a fresh
          one.
        </p>
      </div>
    </main>
  );

  if (!daycareId || !process.env.NEXT_PUBLIC_SUPABASE_URL) return invalid;

  const supabase = await getServerSupabase();
  const center = await getPublicCenterInfo(supabase, daycareId).catch(() => null);
  if (!center) return invalid;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div
        className="flex w-[380px] max-w-full flex-col gap-3.5 rounded-[28px] border border-[rgba(23,51,91,.12)] bg-card p-6"
        style={{ boxShadow: "0 14px 40px rgba(23,51,91,.16)" }}
      >
        <BrandMark size="sm" />
        <div>
          <h1 className="text-[19px] font-extrabold text-ink">
            Say hello to {center.name}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            We reply within one business day.
          </p>
        </div>
        <InquiryForm daycareId={daycareId} programs={center.programs} />
      </div>
    </main>
  );
}
