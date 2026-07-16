import { getStaffMember } from "@dailylog/db/queries";
import { notFound } from "next/navigation";
import { StaffProfileView } from "@/components/staff/staff-profile-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Educator profile 4b — certifications, employment, contact. Schedule,
// permissions matrix and documents are later phases.
export default async function StaffProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ id }, { edit }] = await Promise.all([params, searchParams]);
  const supabase = await getServerSupabase();

  let member: Awaited<ReturnType<typeof getStaffMember>>;
  try {
    member = await getStaffMember(supabase, id);
  } catch {
    notFound();
  }
  if (!member.profile) notFound();

  return <StaffProfileView member={member} openEdit={edit === "1"} />;
}
