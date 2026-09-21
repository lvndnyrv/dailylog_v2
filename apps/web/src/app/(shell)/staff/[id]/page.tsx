import {
  getMyProfile,
  getStaffMember,
  listStaffCredentialSubmissions,
  listStaffRegularSchedule,
} from "@dailylog/db/queries";
import { notFound } from "next/navigation";
import { StaffProfileView } from "@/components/staff/staff-profile-view";
import type { StaffPermissionMatrixData } from "@/components/staff/staff-permissions-modal";
import { getServerSupabase } from "@/lib/supabase/server";

// Educator profile 4b/4i — certifications, employment, contact, regular
// schedule publishing, credential documents, and the role-permission summary.
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
  let regularSchedule: Awaited<ReturnType<typeof listStaffRegularSchedule>> = [];
  const currentProfile = await getMyProfile(supabase);
  let permissionMatrix: StaffPermissionMatrixData | null = null;
  try {
    [member, credentialSubmissions, regularSchedule] = await Promise.all([
      getStaffMember(supabase, id),
      listStaffCredentialSubmissions(supabase, id),
      listStaffRegularSchedule(supabase, id),
    ]);
  } catch {
    notFound();
  }
  if (!member.profile) notFound();

  const { data: permissionData } = await supabase.rpc(
    "get_staff_permission_matrix" as never,
    { p_profile_id: member.profile.id } as never,
  );
  permissionMatrix = permissionData as StaffPermissionMatrixData | null;

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
      regularSchedule={regularSchedule}
      currentProfileId={currentProfile?.id ?? null}
      permissionMatrix={permissionMatrix}
    />
  );
}
