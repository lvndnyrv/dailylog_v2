"use client";

import type { Tables } from "@dailylog/db";
import { useActionState } from "react";
import { updateChildAction, type ChildActionState } from "@/lib/children/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Edit child profile 19d. Photo upload arrives with storage wiring (Phase 2).
export function EditChildModal({
  child,
  classrooms,
  onClose,
}: {
  child: Tables<"children">;
  classrooms: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<ChildActionState, FormData>(
    updateChildAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={720}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Edit profile</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Changes show up in the educator and parent apps the moment you save.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="child_id" value={child.id} />

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="First name" name="first_name" defaultValue={child.first_name} required />
          <Field label="Last name" name="last_name" defaultValue={child.last_name} required />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Preferred name (optional)"
            name="preferred_name"
            defaultValue={child.preferred_name ?? ""}
            placeholder="Davey"
          />
          <Field
            label="Pronouns (optional)"
            name="pronouns"
            defaultValue={child.pronouns ?? ""}
            placeholder="he / him"
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Date of birth"
            name="date_of_birth"
            type="date"
            defaultValue={child.date_of_birth ?? ""}
          />
          <Field
            label="Enrollment date"
            name="enrolled_on"
            type="date"
            defaultValue={child.enrolled_on ?? ""}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Room</span>
            <select
              name="classroom_id"
              defaultValue={child.classroom_id ?? ""}
              className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-[15px] text-ink outline-none focus:border-primary"
            >
              <option value="">No room</option>
              {classrooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Home address"
            name="home_address"
            defaultValue={child.home_address ?? ""}
          />
        </div>

        <Field
          label="Allergies (comma-separated)"
          name="allergies"
          defaultValue={(child.allergies ?? []).join(", ")}
          placeholder="Peanuts, Dairy"
        />

        <label className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-bold text-ink">Medical notes</span>
          <textarea
            name="medical_notes"
            defaultValue={child.medical_notes ?? ""}
            rows={3}
            className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-[14px] leading-relaxed text-ink outline-none focus:border-primary"
          />
        </label>

        <Field
          label="Dietary needs (optional)"
          name="dietary_needs"
          defaultValue={child.dietary_needs ?? ""}
          placeholder="e.g. no pork, vegetarian"
        />

        {state.ok && (
          <Notice tone="success">
            <b>Saved.</b>
          </Notice>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}

        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
