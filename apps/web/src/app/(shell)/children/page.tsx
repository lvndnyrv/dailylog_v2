import {
  listClassrooms,
  listConsentRegister,
  listMedicalRegister,
  listRoster,
} from "@dailylog/db/queries";
import {
  RosterView,
  type ChildrenTab,
} from "@/components/children/roster-view";
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
  const [children, classrooms, medical, consents] = await Promise.all([
    listRoster(supabase),
    listClassrooms(supabase),
    listMedicalRegister(supabase),
    listConsentRegister(supabase),
  ]);

  const startingSoon = children.filter(
    (c) => c.enrolled_on && new Date(c.enrolled_on) > new Date(),
  ).length;
  const initialTab: ChildrenTab =
    params.tab === "byroom" || params.tab === "medical" || params.tab === "consents"
      ? params.tab
      : "all";

  return (
    <RosterView
      childrenRows={children}
      classrooms={classrooms}
      medical={medical}
      consentRows={consents}
      startingSoon={startingSoon}
      openCreate={params.new === "1"}
      initialTab={initialTab}
    />
  );
}
