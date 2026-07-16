"use client";

import { useActionState, useState } from "react";
import { createBroadcastAction, type MessageActionState } from "@/lib/messages/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// New broadcast 5b — one message to many; lands in every family's app feed.
// Scheduling and per-language delivery arrive with notifications infra.
export function BroadcastModal({
  classrooms,
  onClose,
}: {
  classrooms: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<MessageActionState, FormData>(
    createBroadcastAction,
    {},
  );
  const [audience, setAudience] = useState("");

  const chip = (active: boolean) =>
    `cursor-pointer rounded-full px-3 py-1.5 text-xs ${
      active
        ? "bg-primary font-bold text-white"
        : "border-[1.5px] border-[#D6E1F0] bg-card font-semibold text-body hover:bg-canvas"
    }`;

  return (
    <Modal onClose={onClose} width={470}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">New broadcast</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          One message to many — it lands in every family&apos;s app feed.
        </p>
      </div>

      {state.ok ? (
        <>
          <Notice tone="success">
            <b>Sent.</b> Families see it the next time they open the app.
          </Notice>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-bold text-ink">To</legend>
            <input type="hidden" name="classroom_id" value={audience} />
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={chip(audience === "")} onClick={() => setAudience("")}>
                All families
              </button>
              {classrooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  className={chip(audience === room.id)}
                  onClick={() => setAudience(room.id)}
                >
                  {room.name}
                </button>
              ))}
            </div>
          </fieldset>

          <Field label="Title" name="title" placeholder="Water play day this Friday" required />

          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Message</span>
            <textarea
              name="body"
              rows={4}
              required
              placeholder="Pack swimsuits and a towel — we'll be outside all morning."
              className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] leading-relaxed text-ink outline-none placeholder:text-faint focus:border-primary"
            />
          </label>

          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-[12.5px] font-semibold text-body">
              <input type="checkbox" name="pinned" className="size-4 rounded accent-[var(--primary)]" />
              Pin to the top
            </label>
            <label className="flex items-center gap-2 text-[12.5px] font-semibold text-body">
              <input type="checkbox" name="rsvp_enabled" className="size-4 rounded accent-[var(--primary)]" />
              Ask for RSVPs
            </label>
          </div>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Sending…" : "Send broadcast"}
            </Button>
          </div>
          <p className="text-center text-[11px] text-faint">
            Push + email delivery and scheduling arrive with notifications infra.
          </p>
        </form>
      )}
    </Modal>
  );
}
