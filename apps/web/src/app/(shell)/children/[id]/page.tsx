import { getChildProfile, listClassrooms } from "@dailylog/db/queries";
import { notFound } from "next/navigation";
import { ChildProfileView } from "@/components/children/child-profile-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Child profile 19a — the tabbed record: overview, guardians & pickups,
// medical, consents. Setup panel 19b, pickup modal 19c, edit modal 19d.
export default async function ChildProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ id }, { edit }] = await Promise.all([params, searchParams]);
  const supabase = await getServerSupabase();

  let data: Awaited<ReturnType<typeof getChildProfile>>;
  try {
    data = await getChildProfile(supabase, id);
  } catch {
    notFound();
  }

  const classrooms = await listClassrooms(supabase);
  const photoUrl = data.child.photo_url
    ? (
        await supabase.storage
          .from("child-avatars")
          .createSignedUrl(data.child.photo_url, 3600)
      ).data?.signedUrl ?? null
    : null;

  return (
    <ChildProfileView
      child={data.child as never}
      pickups={data.pickups}
      medications={data.medications as never}
      consents={data.consents as never}
      documents={data.documents}
      pendingInvites={data.pendingInvites}
      classrooms={classrooms}
      photoUrl={photoUrl}
      openEdit={edit === "1"}
    />
  );
}

export function generateMetadata() {
  return { title: "Child profile — DailyLog Admin" };
}
