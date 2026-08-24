import { getStaffMember, listStaffCredentialSubmissions } from "@dailylog/db/queries";
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
  let credentialSubmissions: Awaited<ReturnType<typeof listStaffCredentialSubmissions>> = [];
  try {
    [member, credentialSubmissions] = await Promise.all([
      getStaffMember(supabase, id),
      listStaffCredentialSubmissions(supabase, id),
    ]);
  } catch {
    notFound();
  }
  if (!member.profile) notFound();

  const submissionsWithUrls = await Promise.all(
    credentialSubmissions.map(async (submission) => {
      if (!submission.document?.storage_path) return { ...submission, documentUrl: null };
      const { data } = await supabase.storage
        .from("documents")
        .createSignedUrl(submission.document.storage_path, 10 * 60);
      return { ...submission, documentUrl: data?.signedUrl ?? null };
    }),
  );

  return (
    <StaffProfileView
      member={member}
      openEdit={edit === "1"}
      credentialSubmissions={submissionsWithUrls}
    />
  );
}
