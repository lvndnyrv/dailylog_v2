"use client";

import type { Broadcast, InboxThread, ThreadMessage } from "@dailylog/db/queries";
import { isStaffRole } from "@dailylog/shared";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { markReadAction } from "@/lib/messages/actions";
import { BroadcastModal } from "./broadcast-modal";
import { ReplyComposer } from "./reply-composer";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card";

type Filter = "all" | "unread";

export function MessagesView({
  threads,
  selected,
  messages,
  broadcasts,
  classrooms,
  openBroadcast = false,
}: {
  threads: InboxThread[];
  selected: InboxThread | null;
  messages: ThreadMessage[];
  broadcasts: Broadcast[];
  classrooms: { id: string; name: string }[];
  openBroadcast?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [broadcasting, setBroadcasting] = useState(openBroadcast);
  const markedRef = useRef<string | null>(null);

  // Opening an unread thread marks the family's messages read (once).
  useEffect(() => {
    if (
      selected &&
      Number(selected.unread_count) > 0 &&
      markedRef.current !== selected.conversation_id
    ) {
      markedRef.current = selected.conversation_id;
      const formData = new FormData();
      formData.set("child_id", selected.child_id);
      void markReadAction(formData);
    }
  }, [selected]);

  const visible = threads.filter((thread) => {
    if (filter === "unread" && Number(thread.unread_count) === 0) return false;
    if (search) {
      const hay =
        `${thread.child_first_name} ${thread.child_last_name} ${thread.room_name ?? ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs ${
      active
        ? "bg-primary font-bold text-white"
        : "border-[1.5px] border-[#D6E1F0] bg-card font-semibold text-body hover:bg-canvas"
    }`;

  return (
    <div className="grid flex-1 grid-cols-[minmax(300px,1.1fr)_2fr] items-start gap-4 p-7">
      {/* Thread list */}
      <div className={`${card} flex flex-col overflow-hidden`}>
        <div className="flex flex-col gap-2.5 border-b border-[#EDF3FB] p-3.5">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search families"
            aria-label="Search conversations"
            className="rounded-[11px] border-[1.5px] border-[#D6E1F0] bg-canvas px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-primary"
          />
          <div className="flex items-center gap-1.5">
            <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>
              All · {threads.length}
            </button>
            <button
              type="button"
              className={chip(filter === "unread")}
              onClick={() => setFilter("unread")}
            >
              Needs reply · {threads.filter((t) => Number(t.unread_count) > 0).length}
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setBroadcasting(true)}
              className="rounded-btn bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover"
            >
              New broadcast
            </button>
          </div>
        </div>

        <div className="flex flex-col overflow-y-auto">
          {visible.map((thread) => {
            const active = selected?.conversation_id === thread.conversation_id;
            const unread = Number(thread.unread_count) > 0;
            return (
              <Link
                key={thread.conversation_id}
                href={`/messages?t=${thread.conversation_id}`}
                aria-current={active ? "true" : undefined}
                className={`flex items-start gap-2.5 border-b border-[#EDF3FB] px-3.5 py-3 last:border-b-0 ${
                  active ? "bg-[#E7F0FB]" : "hover:bg-[#F8FBFE]"
                }`}
              >
                <Avatar
                  name={`${thread.child_first_name} ${thread.child_last_name}`}
                  size={34}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={`truncate text-[13px] ${unread ? "font-extrabold" : "font-bold"} text-ink`}>
                      {thread.child_first_name}&apos;s family
                    </span>
                    <span className="ml-auto whitespace-nowrap text-[10.5px] text-faint">
                      {timeAgo(thread.last_message_at)}
                    </span>
                  </span>
                  <span className="block truncate text-[11px] text-faint">
                    {thread.child_first_name} {thread.child_last_name}
                    {thread.room_name ? ` · ${thread.room_name}` : ""}
                  </span>
                  <span
                    className={`block truncate text-[12px] ${
                      unread ? "font-semibold text-ink" : "text-muted"
                    }`}
                  >
                    {thread.last_message_from_staff ? "You: " : ""}
                    {thread.last_message_body}
                  </span>
                </span>
                {unread && (
                  <span className="mt-1 grid size-5 flex-none place-items-center rounded-full bg-primary text-[10px] font-bold text-white">
                    {thread.unread_count}
                  </span>
                )}
              </Link>
            );
          })}
          {visible.length === 0 && (
            <p className="px-4 py-8 text-center text-[12.5px] text-faint">
              {threads.length === 0
                ? "No conversations yet — they start from the family's app."
                : "Nothing matches."}
            </p>
          )}
        </div>
      </div>

      {/* Right pane: thread or broadcast history */}
      {selected ? (
        <div className={`${card} flex min-h-[420px] flex-col overflow-hidden`}>
          <div className="flex items-center gap-2.5 border-b border-[#EDF3FB] px-4 py-3">
            <Avatar
              name={`${selected.child_first_name} ${selected.child_last_name}`}
              size={34}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-extrabold text-ink">
                {selected.child_first_name}&apos;s family
              </span>
              <span className="block text-[11.5px] text-muted">
                {selected.child_first_name} {selected.child_last_name}
                {selected.room_name ? ` · ${selected.room_name}` : ""}
              </span>
            </span>
            <Link
              href={`/children/${selected.child_id}`}
              className="rounded-btn border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-xs font-bold text-primary hover:bg-canvas"
            >
              Child profile
            </Link>
          </div>

          <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
            {messages.map((message) => {
              const fromStaff = isStaffRole(message.sender?.role);
              return (
                <div
                  key={message.id}
                  className={`flex max-w-[78%] flex-col gap-0.5 ${
                    fromStaff ? "self-end items-end" : "self-start"
                  }`}
                >
                  <span className="px-1 text-[10.5px] text-faint">
                    {fromStaff ? "You" : message.sender?.full_name ?? "Parent"} ·{" "}
                    {timeAgo(message.created_at)}
                  </span>
                  <span
                    className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                      fromStaff
                        ? "rounded-br-md bg-primary text-white"
                        : "rounded-bl-md bg-canvas text-ink"
                    }`}
                  >
                    {message.body}
                  </span>
                </div>
              );
            })}
          </div>

          <ReplyComposer
            conversationId={selected.conversation_id}
            childId={selected.child_id}
            familyLabel={`${selected.child_first_name}'s family`}
          />
        </div>
      ) : (
        <div className={`${card} flex flex-col gap-3 p-[18px]`}>
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-extrabold text-ink">Broadcast history</h2>
            <span className="text-[11.5px] text-faint">
              lands in every family&apos;s app feed
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setBroadcasting(true)}
              className="rounded-btn bg-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-primary-hover"
            >
              New broadcast
            </button>
          </div>
          {broadcasts.length === 0 ? (
            <p className="text-[12.5px] text-faint">Nothing sent yet.</p>
          ) : (
            broadcasts.map((broadcast) => {
              const yes = broadcast.rsvps.filter((rsvp) => rsvp.response === "yes").length;
              return (
                <div
                  key={broadcast.id}
                  className="flex flex-col gap-1 rounded-xl border border-[#EDF3FB] px-3.5 py-3"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold text-ink">{broadcast.title}</span>
                    {broadcast.pinned && (
                      <span className="rounded-full bg-warning-bg px-2 py-px text-[10px] font-bold text-warning-text">
                        Pinned
                      </span>
                    )}
                    <span className="ml-auto whitespace-nowrap text-[10.5px] text-faint">
                      {timeAgo(broadcast.created_at)}
                    </span>
                  </span>
                  <span className="text-[12px] leading-relaxed text-muted">{broadcast.body}</span>
                  <span className="text-[11px] text-faint">
                    To {broadcast.classroom?.name ?? "all families"} ·{" "}
                    {broadcast.author?.full_name ?? "—"}
                    {broadcast.rsvp_enabled &&
                      ` · ${yes} yes${broadcast.rsvps.length ? ` of ${broadcast.rsvps.length} replies` : ""}`}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}

      {broadcasting && (
        <BroadcastModal classrooms={classrooms} onClose={() => setBroadcasting(false)} />
      )}
    </div>
  );
}

function timeAgo(timestamp: string | null): string {
  if (!timestamp) return "";
  const minutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return new Date(timestamp).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}
