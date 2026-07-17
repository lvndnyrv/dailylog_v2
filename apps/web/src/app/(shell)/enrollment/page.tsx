import { getMyProfile, listClassrooms, listEnrollments } from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { EnrollmentBoard } from "@/components/enrollment/enrollment-board";
import { getServerSupabase } from "@/lib/supabase/server";

const RECENT_DAYS = 30;

function countRecent(enrollments: { created_at: string | null }[]): number {
  const cutoffMs = Date.now() - RECENT_DAYS * 86400000;
  return enrollments.filter(
    (e) => e.created_at && new Date(e.created_at).getTime() > cutoffMs,
  ).length;
}

// Enrollment pipeline 2d — inquiry → tour → application → offer → enrolled.
export default async function EnrollmentPage() {
  const supabase = await getServerSupabase();
  const [enrollments, classrooms, profile] = await Promise.all([
    listEnrollments(supabase),
    listClassrooms(supabase),
    getMyProfile(supabase),
  ]);

  const recent = countRecent(enrollments);

  return (
    <>
      <SectionHeader
        title="Enrollment"
        subtitle={`${recent} inquiries in the last ${RECENT_DAYS} days · every stage move is logged`}
      />
      <EnrollmentBoard
        enrollments={enrollments}
        classrooms={classrooms}
        daycareId={profile?.daycare_id ?? ""}
      />
    </>
  );
}
