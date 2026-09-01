import {
  getMyProfile,
  getOrCreateStaffConversation,
  getStaffMember,
  getThreadMessages,
} from "@dailylog/db/queries";
import { notFound, redirect } from "next/navigation";
import { StaffConversationView } from "@/components/staff/staff-conversation-view";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function StaffConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getServerSupabase();

  let member: Awaited<ReturnType<typeof getStaffMember>>;
  try {
    member = await getStaffMember(supabase, id);
  } catch {
    notFound();
  }
  if (!member.profile) notFound();

  const currentProfile = await getMyProfile(supabase);
  if (!currentProfile || currentProfile.id === member.profile.id) {
    redirect(`/staff/${id}`);
  }

  const conversationId = await getOrCreateStaffConversation(supabase, member.profile.id);
  const messages = await getThreadMessages(supabase, conversationId);

  return (
    <StaffConversationView
      staffMemberId={member.id}
      conversationId={conversationId}
      currentProfileId={currentProfile.id}
      otherProfile={{
        id: member.profile.id,
        fullName: member.profile.full_name,
        role: member.job_title ?? ROLE_LABELS[member.profile.role] ?? member.profile.role,
      }}
      initialMessages={messages}
    />
  );
}

const ROLE_LABELS: Record<string, string> = {
  owner_admin: "Owner admin",
  admin: "Administrator",
  educator: "Educator",
};
