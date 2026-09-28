"use client";

import type { Broadcast } from "@dailylog/db/queries";
import { useActionState, useState } from "react";
import { createBroadcastAction, type MessageActionState } from "@/lib/messages/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// New broadcast 5b/5c — one message to many, sent now or scheduled for later.
export function BroadcastModal({
  classrooms,
  broadcast = null,
  onClose,
}: {
  classrooms: { id: string; name: string }[];
  broadcast?: Broadcast | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<MessageActionState, FormData>(
    createBroadcastAction,
    {},
  );
  const [audience, setAudience] = useState(broadcast?.classroom?.id ?? "");
  const [audienceType, setAudienceType] = useState<"families" | "staff">(
    broadcast?.audience_type === "staff" ? "staff" : "families",
  );
  const [title, setTitle] = useState(broadcast?.title ?? "");
  const [body, setBody] = useState(broadcast?.body ?? "");
  const [delivery, setDelivery] = useState<"now" | "schedule">(
    broadcast ? "schedule" : "now",
  );
  const [scheduledFor, setScheduledFor] = useState(
    toLocalDateTime(broadcast?.scheduled_for) || defaultScheduleTime(),
  );
  const [rsvpEnabled, setRsvpEnabled] = useState(broadcast?.rsvp_enabled ?? false);
  const [eventAt, setEventAt] = useState(toLocalDateTime(broadcast?.event_at));
  const [eventEndsAt, setEventEndsAt] = useState(toLocalDateTime(broadcast?.event_ends_at));

  const chip = (active: boolean) =>
    `cursor-pointer rounded-full px-3 py-1.5 text-xs ${
      active
        ? "bg-primary font-bold text-white"
        : "border-[1.5px] border-[#D6E1F0] bg-card font-semibold text-body hover:bg-canvas"
    }`;

  return (
    <Modal onClose={onClose} width={470}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">
          {broadcast ? "Edit scheduled broadcast" : "New broadcast"}
        </h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          {audienceType === "staff"
            ? "Share one update with the whole center team."
            : "One message to many — it lands in every family&apos;s app feed."}
        </p>
      </div>

      {state.ok ? (
        <>
          <Notice tone="success">
            <b>{delivery === "schedule" ? "Scheduled." : "Sent."}</b>{" "}
            {delivery === "schedule"
              ? `${audienceType === "staff" ? "Staff" : "Families"} will not see it until the selected delivery time.`
              : audienceType === "staff"
                ? "It is now in the team's announcement feed."
                : "It is now in the selected families' announcement feed."}
          </Notice>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          {broadcast && <input type="hidden" name="announcement_id" value={broadcast.id} />}
          <input type="hidden" name="audience_type" value={audienceType} />
          <input type="hidden" name="delivery" value={delivery} />
          <input
            type="hidden"
            name="scheduled_for"
            value={delivery === "schedule" && scheduledFor ? new Date(scheduledFor).toISOString() : ""}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-bold text-ink">To</legend>
            <input type="hidden" name="classroom_id" value={audience} />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={chip(audienceType === "families" && audience === "")}
                onClick={() => {
                  setAudienceType("families");
                  setAudience("");
                }}
              >
                All families
              </button>
              {classrooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  className={chip(audienceType === "families" && audience === room.id)}
                  onClick={() => {
                    setAudienceType("families");
                    setAudience(room.id);
                  }}
                >
                  {room.name}
                </button>
              ))}
              <button
                type="button"
                className={chip(audienceType === "staff")}
                onClick={() => {
                  setAudienceType("staff");
                  setAudience("");
                  setRsvpEnabled(false);
                }}
              >
                Staff only
              </button>
            </div>
          </fieldset>

          {!broadcast && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[13px] font-bold text-ink">Start from a template</legend>
              <div className="flex flex-wrap gap-1.5">
                {BROADCAST_TEMPLATES.map((template) => (
                  <button
                    key={template.title}
                    type="button"
                    onClick={() => {
                      setTitle(template.title);
                      setBody(template.body);
                    }}
                    className="rounded-full border-[1.5px] border-[#D6E1F0] bg-card px-3 py-1.5 text-[11.5px] font-bold text-body hover:bg-canvas"
                  >
                    {template.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <Field
            label="Title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Water play day this Friday"
            maxLength={200}
            required
          />

          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Message</span>
            <textarea
              name="body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              required
              maxLength={4000}
              placeholder="Pack swimsuits and a towel — we'll be outside all morning."
              className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] leading-relaxed text-ink outline-none placeholder:text-faint focus:border-primary"
            />
          </label>

          <div className="flex items-center gap-5">
            {audienceType === "families" && <label className="flex items-center gap-2 text-[12.5px] font-semibold text-body">
              <input
                type="checkbox"
                name="pinned"
                defaultChecked={broadcast?.pinned ?? false}
                className="size-4 rounded accent-[var(--primary)]"
              />
              Pin to the top
            </label>}
            {audienceType === "families" && (
              <label className="flex items-center gap-2 text-[12.5px] font-semibold text-body">
                <input
                  type="checkbox"
                  name="rsvp_enabled"
                  checked={rsvpEnabled}
                  onChange={(event) => setRsvpEnabled(event.target.checked)}
                  className="size-4 rounded accent-[var(--primary)]"
                />
                Ask for RSVPs
              </label>
            )}
          </div>

          {audienceType === "families" && rsvpEnabled ? (
            <fieldset className="rounded-[15px] border-[1.5px] border-[#D6E1F0] bg-canvas p-4">
              <legend className="px-1 text-[13px] font-bold text-ink">Event details</legend>
              <input
                type="hidden"
                name="event_at"
                value={eventAt ? new Date(eventAt).toISOString() : ""}
              />
              <input
                type="hidden"
                name="event_ends_at"
                value={eventEndsAt ? new Date(eventEndsAt).toISOString() : ""}
              />
              <div className="mt-1 grid grid-cols-2 gap-3">
                <label className="col-span-2 flex flex-col gap-[7px] text-[13px] font-bold text-ink">
                  Starts
                  <input
                    type="datetime-local"
                    value={eventAt}
                    onChange={(event) => setEventAt(event.target.value)}
                    required
                    className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] font-normal text-ink outline-none focus:border-primary"
                  />
                </label>
                <label className="col-span-2 flex flex-col gap-[7px] text-[13px] font-bold text-ink">
                  Ends
                  <input
                    type="datetime-local"
                    value={eventEndsAt}
                    onChange={(event) => setEventEndsAt(event.target.value)}
                    required
                    className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] font-normal text-ink outline-none focus:border-primary"
                  />
                </label>
                <label className="col-span-2 flex flex-col gap-[7px] text-[13px] font-bold text-ink">
                  Location
                  <input
                    type="text"
                    name="event_location"
                    defaultValue={broadcast?.event_location ?? ""}
                    required
                    maxLength={240}
                    placeholder="Fairy Lake Park · North shelter"
                    className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] font-normal text-ink outline-none placeholder:text-faint focus:border-primary"
                  />
                </label>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                Families will see the event details and can reply Yes, Maybe, or No in the parent app.
              </p>
            </fieldset>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-bold text-ink">Delivery</legend>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={chip(delivery === "now")} onClick={() => setDelivery("now")}>Send now</button>
              <button type="button" className={chip(delivery === "schedule")} onClick={() => setDelivery("schedule")}>Schedule…</button>
            </div>
            {delivery === "schedule" && (
              <label className="mt-1 flex flex-col gap-[7px] text-[13px] font-bold text-ink">
                Send on
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(event) => setScheduledFor(event.target.value)}
                  required
                  className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] font-normal text-ink outline-none focus:border-primary"
                />
              </label>
            )}
            <p className="text-[11px] leading-relaxed text-faint">
              Quiet hours and each recipient&apos;s delivery preferences are respected by the notification worker.
            </p>
          </fieldset>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending
                ? broadcast ? "Saving…" : "Sending…"
                : delivery === "schedule"
                  ? broadcast ? "Save schedule" : "Schedule broadcast"
                  : "Send broadcast"}
            </Button>
          </div>
          <p className="text-center text-[11px] text-faint">
            {audienceType === "staff"
              ? "Active staff members receive this in Announcements and as a push notification."
              : "Families with announcement alerts enabled also receive a push notification."}
          </p>
        </form>
      )}
    </Modal>
  );
}

const BROADCAST_TEMPLATES = [
  {
    label: "Unexpected closure",
    title: "Important center closure",
    body: "The center will be closed. Please open this announcement for the latest timing and reopening details.",
  },
  {
    label: "Illness notice",
    title: "Health notice for families",
    body: "We are monitoring an illness in the center. Please watch for symptoms and keep your child home if they are unwell.",
  },
  {
    label: "Photo day reminder",
    title: "Photo day reminder",
    body: "Photo day is coming up. Please arrive on time and send any notes about clothing or participation to your educator.",
  },
] as const;

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function defaultScheduleTime(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(7, 30, 0, 0);
  return toLocalDateTime(date.toISOString());
}
