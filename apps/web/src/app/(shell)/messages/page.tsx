import {
  getThreadMessages,
  listBroadcasts,
  listClassrooms,
  listInboxThreads,
} from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { MessagesView } from "@/components/messages/messages-view";
import { getServerSupabase } from "@/lib/supabase/server";

// Messages inbox 5a — thread list + reply pane. Broadcast history 5c fills the
// right pane when no thread is open; 5b composes a new broadcast.
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t: selectedId } = await searchParams;
  const supabase = await getServerSupabase();

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
      />
    </>
  );
}
