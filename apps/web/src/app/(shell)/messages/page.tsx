import {
  getMyProfile,
  getThreadMessages,
  listBroadcasts,
  listClassrooms,
  listInboxThreads,
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

  const [threads, broadcasts, classrooms] = await Promise.all([
    listInboxThreads(supabase),
    listBroadcasts(supabase),
    listClassrooms(supabase),
  ]);

  const selected = threads.find((thread) => thread.conversation_id === selectedId) ?? null;
  const messages = selected ? await getThreadMessages(supabase, selected.conversation_id) : [];

  const needsReply = threads.filter((thread) => Number(thread.unread_count) > 0).length;

  return (
    <>
      <SectionHeader
        title="Messages"
        subtitle={`${threads.length} conversations${
          needsReply ? ` · ${needsReply} need a reply` : ""
        } · replies land in the family's app`}
      />
      <MessagesView
        threads={threads}
        selected={selected}
        messages={messages}
        broadcasts={broadcasts}
        classrooms={classrooms}
        openBroadcast={broadcast === "1"}
      />
    </>
  );
}
