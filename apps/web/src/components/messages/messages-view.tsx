"use client";

import type {
  Broadcast,
  InboxThread,
  StaffConversationSummary,
  ThreadMessage,
} from "@dailylog/db/queries";
import { isStaffRole } from "@dailylog/shared";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import {
  cancelScheduledBroadcastAction,
  markReadAction,
  markStaffReadAction,
} from "@/lib/messages/actions";
import { BroadcastModal } from "./broadcast-modal";
import {
  NewMessageModal,
  type StaffMessageCandidate,
} from "./new-message-modal";
import { ReplyComposer } from "./reply-composer";
import { StaffReplyComposer } from "./staff-reply-composer";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card";

type Filter = "all" | "unread" | "staff";

export function MessagesView({
  threads,
  staffThreads,
  selected,
  selectedStaff,
  messages,
  broadcasts,
  classrooms,
  currentProfileId,
  staffCandidates,
  openBroadcast = false,
}: {
  threads: InboxThread[];
  staffThreads: StaffConversationSummary[];
  selected: InboxThread | null;
  selectedStaff: StaffConversationSummary | null;
  messages: ThreadMessage[];
  broadcasts: Broadcast[];
  classrooms: { id: string; name: string }[];
  currentProfileId: string | null;
  staffCandidates: StaffMessageCandidate[];
  openBroadcast?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [broadcasting, setBroadcasting] = useState(openBroadcast);
  const [newMessage, setNewMessage] = useState(false);
  const [editingBroadcast, setEditingBroadcast] = useState<Broadcast | null>(null);
  const markedRef = useRef<string | null>(null);

  // Opening an unread family or staff thread marks it read once.
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
    if (
      selectedStaff &&
      Number(selectedStaff.unread_count) > 0 &&
      markedRef.current !== selectedStaff.conversation_id
    ) {
      markedRef.current = selectedStaff.conversation_id;
      const formData = new FormData();
      formData.set("conversation_id", selectedStaff.conversation_id);
      void markStaffReadAction(formData);
    }
  }, [selected, selectedStaff]);

  const visibleFamilies = threads.filter((thread) => {
    if (filter === "staff") return false;
    if (filter === "unread" && Number(thread.unread_count) === 0) return false;
    if (search) {
      const hay =
        `${thread.family_name} ${thread.child_first_name} ${thread.child_last_name} ${thread.room_name ?? ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });
  const visibleStaff = staffThreads.filter((thread) => {
    if (filter === "unread" && Number(thread.unread_count) === 0) return false;
    if (search) {
      const hay = `${thread.other_full_name} ${thread.other_role}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });
  const visibleItems = [
    ...visibleFamilies.map((thread) => ({ kind: "family" as const, thread })),
    ...visibleStaff.map((thread) => ({ kind: "staff" as const, thread })),
  ].sort(
    (a, b) =>
      new Date(b.thread.last_message_at ?? 0).getTime() -
      new Date(a.thread.last_message_at ?? 0).getTime(),
  );
  const totalThreads = threads.length + staffThreads.length;
  const unreadThreads = [...threads, ...staffThreads].filter(
    (thread) => Number(thread.unread_count) > 0,
  ).length;

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
            placeholder="Search families or staff"
            aria-label="Search conversations"
            className="rounded-[11px] border-[1.5px] border-[#D6E1F0] bg-canvas px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-primary"
          />
          <div className="flex items-center gap-1.5">
            <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>
              All · {totalThreads}
            </button>
            <button
              type="button"
              className={chip(filter === "unread")}
              onClick={() => setFilter("unread")}
            >
              Needs reply · {unreadThreads}
            </button>
            <button
              type="button"
              className={chip(filter === "staff")}
              onClick={() => setFilter("staff")}
            >
              Staff · {staffThreads.length}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setBroadcasting(true)}
              className="flex-1 rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-3 py-2 text-xs font-bold text-primary hover:bg-canvas"
            >
              New broadcast
            </button>
            <button
              type="button"
              onClick={() => setNewMessage(true)}
              className="flex-1 rounded-btn bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary-hover"
            >
              + New message
            </button>
          </div>
        </div>

        <div className="flex flex-col overflow-y-auto">
          {visibleItems.map((item) =>
            item.kind === "family" ? (
              <FamilyThreadLink
                key={item.thread.conversation_id}
                thread={item.thread}
                active={selected?.conversation_id === item.thread.conversation_id}
              />
            ) : (
              <StaffThreadLink
                key={item.thread.conversation_id}
                thread={item.thread}
                active={selectedStaff?.conversation_id === item.thread.conversation_id}
              />
            ),
          )}
          {visibleItems.length === 0 && (
            <p className="px-4 py-8 text-center text-[12.5px] text-faint">
              {totalThreads === 0
                ? "No conversations yet — start a staff message or wait for a family reply."
                : "Nothing matches."}
            </p>
          )}
        </div>
      </div>

      {/* Right pane: thread or broadcast history */}
      {selected || selectedStaff ? (
        <div className={`${card} flex min-h-[420px] flex-col overflow-hidden`}>
          <div className="flex items-center gap-2.5 border-b border-[#EDF3FB] px-4 py-3">
            <Avatar
              name={selectedStaff
                ? selectedStaff.other_full_name
                : `${selected!.child_first_name} ${selected!.child_last_name}`}
              size={34}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-extrabold text-ink">
                {selectedStaff ? selectedStaff.other_full_name : selected!.family_name}
              </span>
              <span className="block text-[11.5px] text-muted">
                {selectedStaff ? (
                  <>{roleLabel(selectedStaff.other_role)} · private staff message</>
                ) : (
                  <>
                    {Number(selected!.family_child_count) > 1
                      ? `${selected!.family_child_count} children · `
                      : ""}
                    {selected!.child_first_name} {selected!.child_last_name}
                    {selected!.room_name ? ` · ${selected!.room_name}` : ""}
                  </>
                )}
              </span>
            </span>
            {selected ? (
              <Link
                href={`/children/${selected.child_id}`}
                className="rounded-btn border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-xs font-bold text-primary hover:bg-canvas"
              >
                Child profile
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setNewMessage(true)}
                className="rounded-btn border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-xs font-bold text-primary hover:bg-canvas"
              >
                Message another staff member
              </button>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
            {messages.map((message) => {
              const mine = selectedStaff
                ? message.sender?.id === currentProfileId
                : isStaffRole(message.sender?.role);
              return (
                <div
                  key={message.id}
                  className={`flex max-w-[78%] flex-col gap-0.5 ${
                    mine ? "self-end items-end" : "self-start"
                  }`}
                >
                  <span className="px-1 text-[10.5px] text-faint">
                    {message.sender?.id === currentProfileId
                      ? "You"
                      : message.sender?.full_name ?? (selectedStaff ? "Staff member" : "Parent")} ·{" "}
                    {timeAgo(message.created_at)}
                  </span>
                  <span
                    className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
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
          </div>

          {selected ? (
            <ReplyComposer
              conversationId={selected.conversation_id}
              childId={selected.child_id}
              familyLabel={selected.family_name}
            />
          ) : (
            <StaffReplyComposer
              conversationId={selectedStaff!.conversation_id}
              staffName={selectedStaff!.other_full_name}
            />
          )}
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
          {broadcasts.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <Metric
                label="Push queued"
                value={`${broadcasts.reduce((sum, item) => sum + item.push_queued, 0)}`}
              />
              <Metric
                label="Recipient reads"
                value={`${broadcasts.reduce((sum, item) => sum + item.read_count, 0)}/${broadcasts.reduce((sum, item) => sum + item.recipient_count, 0)}`}
              />
              <Metric
                label="Scheduled"
                value={`${broadcasts.filter((item) => !item.published_at && !item.cancelled_at).length}`}
              />
            </div>
          )}
          {broadcasts.length === 0 ? (
            <p className="text-[12.5px] text-faint">Nothing sent yet.</p>
          ) : (
            broadcasts.map((broadcast) => {
              const yes = broadcast.rsvps.filter((rsvp) => rsvp.response === "yes").length;
              const scheduled = !broadcast.published_at && !broadcast.cancelled_at;
              const cancelled = Boolean(broadcast.cancelled_at);
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
                    {scheduled && <StatusPill tone="scheduled">Scheduled</StatusPill>}
                    {cancelled && <StatusPill tone="cancelled">Cancelled</StatusPill>}
                    <span className="ml-auto whitespace-nowrap text-[10.5px] text-faint">
                      {scheduled && broadcast.scheduled_for
                        ? `for ${dateTimeLabel(broadcast.scheduled_for)}`
                        : timeAgo(broadcast.published_at ?? broadcast.created_at)}
                    </span>
                  </span>
                  <span className="text-[12px] leading-relaxed text-muted">{broadcast.body}</span>
                  <span className="text-[11px] text-faint">
                    To {broadcast.audience_type === "staff"
                      ? "staff only"
                      : broadcast.classroom?.name ?? "all families"} ·{" "}
                    {broadcast.author?.full_name ?? "—"}
                    {broadcast.rsvp_enabled &&
                      ` · ${yes} yes${broadcast.rsvps.length ? ` of ${broadcast.rsvps.length} replies` : ""}`}
                  </span>
                  {!cancelled && (
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                      {scheduled ? (
                        <>
                          <span>{broadcast.recipient_count} recipients at current enrollment</span>
                          <span className="flex-1" />
                          <button
                            type="button"
                            onClick={() => setEditingBroadcast(broadcast)}
                            className="font-bold text-primary hover:underline"
                          >
                            Edit
                          </button>
                          <form action={cancelScheduledBroadcastAction}>
                            <input type="hidden" name="announcement_id" value={broadcast.id} />
                            <button type="submit" className="font-bold text-danger hover:underline">
                              Cancel schedule
                            </button>
                          </form>
                        </>
                      ) : (
                        <>
                          <span>Read {broadcast.read_count}/{broadcast.recipient_count}</span>
                          <span>Push delivered {broadcast.push_delivered}/{broadcast.push_queued}</span>
                          {broadcast.email_nudged > 0 && (
                            <span>Email reminders {broadcast.email_nudged}</span>
                          )}
                        </>
                      )}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {broadcasting && (
        <BroadcastModal classrooms={classrooms} onClose={() => setBroadcasting(false)} />
      )}
      {editingBroadcast && (
        <BroadcastModal
          classrooms={classrooms}
          broadcast={editingBroadcast}
          onClose={() => setEditingBroadcast(null)}
        />
      )}
      {newMessage && (
        <NewMessageModal staff={staffCandidates} onClose={() => setNewMessage(false)} />
      )}
    </div>
  );
}

function FamilyThreadLink({
  thread,
  active,
}: {
  thread: InboxThread;
  active: boolean;
}) {
  const unread = Number(thread.unread_count) > 0;
  return (
    <Link
      href={`/messages?t=${thread.conversation_id}`}
      aria-current={active ? "true" : undefined}
      className={`flex items-start gap-2.5 border-b border-[#EDF3FB] px-3.5 py-3 last:border-b-0 ${
        active ? "bg-[#E7F0FB]" : "hover:bg-[#F8FBFE]"
      }`}
    >
      <Avatar name={`${thread.child_first_name} ${thread.child_last_name}`} size={34} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`truncate text-[13px] ${unread ? "font-extrabold" : "font-bold"} text-ink`}>
            {thread.family_name}
          </span>
          <span className="ml-auto whitespace-nowrap text-[10.5px] text-faint">
            {timeAgo(thread.last_message_at)}
          </span>
        </span>
        <span className="block truncate text-[11px] text-faint">
          {Number(thread.family_child_count) > 1 ? `${thread.family_child_count} children · ` : ""}
          {thread.child_first_name} {thread.child_last_name}
          {thread.room_name ? ` · ${thread.room_name}` : ""}
        </span>
        <span className={`block truncate text-[12px] ${unread ? "font-semibold text-ink" : "text-muted"}`}>
          {thread.last_message_from_staff ? "Center: " : ""}
          {thread.last_message_body}
        </span>
      </span>
      {unread && <UnreadCount count={thread.unread_count} />}
    </Link>
  );
}

function StaffThreadLink({
  thread,
  active,
}: {
  thread: StaffConversationSummary;
  active: boolean;
}) {
  const unread = Number(thread.unread_count) > 0;
  return (
    <Link
      href={`/messages?t=${thread.conversation_id}`}
      aria-current={active ? "true" : undefined}
      className={`flex items-start gap-2.5 border-b border-[#EDF3FB] px-3.5 py-3 last:border-b-0 ${
        active ? "bg-[#E7F0FB]" : "hover:bg-[#F8FBFE]"
      }`}
    >
      <Avatar name={thread.other_full_name} size={34} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`truncate text-[13px] ${unread ? "font-extrabold" : "font-bold"} text-ink`}>
            {thread.other_full_name}
          </span>
          <span className="rounded-full bg-[#EDF2F9] px-1.5 py-px text-[9px] font-bold text-muted">
            STAFF
          </span>
          <span className="ml-auto whitespace-nowrap text-[10.5px] text-faint">
            {timeAgo(thread.last_message_at)}
          </span>
        </span>
        <span className="block truncate text-[11px] text-faint">
          {roleLabel(thread.other_role)} · private conversation
        </span>
        <span className={`block truncate text-[12px] ${unread ? "font-semibold text-ink" : "text-muted"}`}>
          {thread.last_message_body || "Start a private conversation"}
        </span>
      </span>
      {unread && <UnreadCount count={thread.unread_count} />}
    </Link>
  );
}

function UnreadCount({ count }: { count: number }) {
  return (
    <span className="mt-1 grid size-5 flex-none place-items-center rounded-full bg-primary text-[10px] font-bold text-white">
      {count}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-xl bg-canvas px-3 py-2">
      <span className="block text-[15px] font-extrabold text-ink">{value}</span>
      <span className="block text-[10.5px] font-semibold text-faint">{label}</span>
    </span>
  );
}

function StatusPill({ children, tone }: { children: ReactNode; tone: "scheduled" | "cancelled" }) {
  return (
    <span className={`rounded-full px-2 py-px text-[10px] font-bold ${tone === "scheduled" ? "bg-tint text-primary" : "bg-[#EDF2F9] text-muted"}`}>
      {children}
    </span>
  );
}

function dateTimeLabel(timestamp: string): string {
  return new Date(timestamp).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function roleLabel(role: string): string {
  if (role === "owner_admin") return "Owner admin";
  if (role === "admin") return "Administrator";
  return "Educator";
}

function timeAgo(timestamp: string | null): string {
  if (!timestamp) return "";
  const minutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return new Date(timestamp).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}
