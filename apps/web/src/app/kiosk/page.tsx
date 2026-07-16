import { getMyProfile } from "@dailylog/db/queries";
import { isStaffRole } from "@dailylog/shared";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { KioskView } from "@/components/attendance/kiosk-view";

// Check-in kiosk 8b — the door tablet. The device stays signed in as a staff
// account; families authorize per-check with their 4-digit pickup PIN.
export default async function KioskPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/");
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!isStaffRole(profile?.role)) redirect("/sign-in");

  return <KioskView />;
}
