import {
  getMyProfile,
  getThreadMessages,
  getFamilyThreadTimeline,
  listBroadcasts,
  listClassrooms,
  listInboxThreads,
  listMyStaffConversations,
  listStaff,
} from "@dailylog/db/queries";
import { redirect } from "next/navigation";
import { SectionHeader } from "@/components/shell/header";
import { MessagesView } from "@/components/messages/messages-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Messages inbox 5a — thread list + reply pane. Broadcast history 5c fills the
// right pane when no thread is open; 5b composes a new broadcast.
// ?child=<id> opens (or starts) that family's thread — the entry point from
// child profiles, row menus and incident sign-offs.
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; child?: string; broadcast?: string }>;
}) {
  const { t: selectedId, child: childId, broadcast } = await searchParams;
  const supabase = await getServerSupabase();

  if (childId) {
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("child_id", childId)
      .is("archived_at", null)
      .limit(1);

    let conversationId = existing?.[0]?.id;
    if (!conversationId) {
      const profile = await getMyProfile(supabase);
      if (profile?.daycare_id) {
        const { data: created } = await supabase
          .from("conversations")
          .insert({ daycare_id: profile.daycare_id, child_id: childId, kind: "direct" })
          .select("id")
          .single();
        conversationId = created?.id;
      }
    }
    redirect(conversationId ? `/messages?t=${conversationId}` : "/messages");
  }

  const [threads, staffThreads, broadcasts, classrooms, profile, staff] = await Promise.all([
    listInboxThreads(supabase),
    listMyStaffConversations(supabase),
    listBroadcasts(supabase),
    listClassrooms(supabase),
    getMyProfile(supabase),
    listStaff(supabase),
  ]);

  const selected = threads.find((thread) => thread.conversation_id === selectedId) ?? null;
  const selectedStaff =
    staffThreads.find((thread) => thread.conversation_id === selectedId) ?? null;
  const messages = selected
    ? await getFamilyThreadTimeline(supabase, selected.conversation_id)
    : selectedStaff
      ? await getThreadMessages(supabase, selectedStaff.conversation_id)
      : [];

  const needsReply = [...threads, ...staffThreads].filter(
    (thread) => Number(thread.unread_count) > 0,
  ).length;
  const conversationCount = threads.length + staffThreads.length;

  return (
    <>
      <SectionHeader
        title="Messages"
        subtitle={`${conversationCount} conversations${
          needsReply ? ` · ${needsReply} need a reply` : ""
        } · family and private staff threads in one place`}
      />
      <MessagesView
        threads={threads}
        staffThreads={staffThreads}
        selected={selected}
        selectedStaff={selectedStaff}
        messages={messages}
        broadcasts={broadcasts}
        classrooms={classrooms}
        currentProfileId={profile?.id ?? null}
        staffCandidates={staff
          .filter((member) => member.profile && member.profile.id !== profile?.id)
          .map((member) => ({
            profileId: member.profile!.id,
            fullName: member.profile!.full_name,
            role: member.job_title ?? roleLabel(member.profile!.role),
            roomName: member.profile!.classroom?.name ?? null,
          }))}
        openBroadcast={broadcast === "1"}
      />
    </>
  );
}

function roleLabel(role: string): string {
  if (role === "owner_admin") return "Owner admin";
  if (role === "admin") return "Administrator";
  return "Educator";
}
