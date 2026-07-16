import { listClassrooms, listMedicalRegister, listRoster } from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { RosterView } from "@/components/children/roster-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Children roster 20a — the section home. Tabs: All children / By room /
// Medical & allergies (20b) / Consents.
export default async function ChildrenPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const supabase = await getServerSupabase();
  const [children, classrooms, medical] = await Promise.all([
    listRoster(supabase),
    listClassrooms(supabase),
    listMedicalRegister(supabase),
  ]);

  const startingSoon = children.filter(
    (c) => c.enrolled_on && new Date(c.enrolled_on) > new Date(),
  ).length;

  return (
    <>
      <SectionHeader
        title="Children"
        subtitle={`${children.length} enrolled${startingSoon ? ` · ${startingSoon} starting soon` : ""}`}
      />
      <RosterView
        childrenRows={children}
        classrooms={classrooms}
        medical={medical}
        openCreate={params.new === "1"}
        initialTab={params.tab === "medical" ? "medical" : "all"}
      />
    </>
  );
}
