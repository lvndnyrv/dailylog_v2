"use client";

import type { ThreadMessage } from "@dailylog/db/queries";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export function StaffConversationView({
  staffMemberId,
  conversationId,
  currentProfileId,
  otherProfile,
  initialMessages,
}: {
  staffMemberId: string;
  conversationId: string;
  currentProfileId: string;
  otherProfile: { id: string; fullName: string; role: string };
  initialMessages: ThreadMessage[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef(getBrowserSupabase());

  const refresh = useCallback(async () => {
    const supabase = supabaseRef.current;
    const { data, error: fetchError } = await supabase
      .from("messages")
      .select("id, body, created_at, read_at, sender:profiles!messages_sender_id_fkey(id, full_name, role)")
      .eq("conversation_id", conversationId)
      .order("created_at");
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    setMessages((data ?? []) as unknown as ThreadMessage[]);
    await supabase.rpc("mark_staff_conversation_read", {
      p_conversation_id: conversationId,
    });
  }, [conversationId]);

  useEffect(() => {
    void refresh();
    const supabase = supabaseRef.current;
    const channel = supabase
      .channel(`staff-conversation:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = body.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    const { error: sendError } = await supabaseRef.current.rpc("send_staff_message", {
      p_conversation_id: conversationId,
      p_body: message,
    });
    setSending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setBody("");
    await refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3.5 border-b-[1.5px] border-hairline bg-card px-7 py-5">
        <Link
          href={`/staff/${staffMemberId}`}
          aria-label={`Back to ${otherProfile.fullName}'s profile`}
          className="text-faint hover:text-muted"
        >
          ←
        </Link>
        <Avatar name={otherProfile.fullName} size={44} />
        <span className="min-w-0">
          <span className="block text-[20px] font-extrabold text-ink">{otherProfile.fullName}</span>
          <span className="block text-[12.5px] text-muted">{otherProfile.role} · private staff message</span>
        </span>
        <span className="flex-1" />
        <Link
          href={`/staff/${staffMemberId}`}
          className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2.5 text-[13px] font-bold text-primary hover:bg-canvas"
        >
          View profile
        </Link>
      </header>

      <main className="flex min-h-0 flex-1 justify-center bg-canvas p-7">
        <section className="flex min-h-[540px] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[rgba(23,51,91,.1)] bg-card">
          <div className="border-b border-[#EDF3FB] px-5 py-3.5">
            <p className="text-[12px] text-muted">
              Only you and {otherProfile.fullName} can see this conversation.
            </p>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
            {messages.length === 0 && (
              <div className="m-auto max-w-sm text-center">
                <p className="text-[15px] font-extrabold text-ink">Start a private conversation</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                  Coordinate schedules, room coverage, or follow-up without using a family thread.
                </p>
              </div>
            )}
            {messages.map((message) => {
              const mine = message.sender?.id === currentProfileId;
              return (
                <div
                  key={message.id}
                  className={`flex max-w-[78%] flex-col gap-0.5 ${mine ? "self-end items-end" : "self-start"}`}
                >
                  <span className="px-1 text-[10.5px] text-faint">
                    {mine ? "You" : message.sender?.full_name ?? otherProfile.fullName} · {formatTime(message.created_at)}
                  </span>
                  <span
                    className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                      mine
                        ? "rounded-br-md bg-primary text-white"
                        : "rounded-bl-md bg-canvas text-ink"
                    }`}
                  >
                    {message.body}
                  </span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-[#EDF3FB] px-5 pb-4 pt-3.5">
            <form onSubmit={sendMessage} className="flex items-center gap-2">
              <input
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={`Message ${otherProfile.fullName}…`}
                autoComplete="off"
                maxLength={4000}
                className="flex-1 rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-primary"
              />
              <button
                type="submit"
                disabled={sending || !body.trim()}
                className="rounded-btn bg-primary px-5 py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </form>
            {error && <p className="mt-1.5 text-[11.5px] font-semibold text-danger">{error}</p>}
            <p className="mt-1.5 text-[10.5px] text-faint">Private staff thread · replies appear in real time</p>
          </div>
        </section>
      </main>
    </div>
  );
}

function formatTime(timestamp: string | null): string {
  if (!timestamp) return "now";
  return new Date(timestamp).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
