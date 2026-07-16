"use client";

import { useActionState } from "react";
import { createChildAction, type ChildActionState } from "@/lib/children/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Create child — reached from 18b "Child · profile" and the roster's
// "+ Add child". The full 19d field set is available after creation.
export function CreateChildModal({
  classrooms,
  onClose,
}: {
  classrooms: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<ChildActionState, FormData>(
    createChildAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={560}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Add a child</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Name and room get them on the roster — medical details, contacts and
          parents come next on their profile.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="First name" name="first_name" required />
          <Field label="Last name" name="last_name" required />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Date of birth" name="date_of_birth" type="date" />
          <Field label="Start date" name="enrolled_on" type="date" />
        </div>

        <label className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-bold text-ink">Room</span>
          <select
            name="classroom_id"
            className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-[15px] text-ink outline-none focus:border-primary"
            defaultValue=""
          >
            <option value="">Assign later</option>
            {classrooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </label>

        <Field label="Allergies (comma-separated)" name="allergies" placeholder="Peanuts, Dairy" />
        <Field label="Medical notes" name="medical_notes" placeholder="e.g. carries an EpiPen" />

        {state.error && <Notice tone="error">{state.error}</Notice>}

        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
            {pending ? "Adding…" : "Add child"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
