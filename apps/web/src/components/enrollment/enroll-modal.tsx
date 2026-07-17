"use client";

import type { Enrollment } from "@dailylog/db/queries";
import { useActionState } from "react";
import { enrollAction, type EnrollmentActionState } from "@/lib/enrollment/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Offer accepted (2f) — pick the room, confirm the surname, and the child
// record is created in one step.
export function EnrollModal({
  enrollment,
  classrooms,
  onClose,
}: {
  enrollment: Enrollment;
  classrooms: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<EnrollmentActionState, FormData>(
    enrollAction,
    {},
  );

  const guessedLastName =
    enrollment.child_last_name ??
    enrollment.guardian_name?.split(" ").slice(-1)[0] ??
    "";

  return (
    <Modal onClose={onClose} width={400}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">
          Enroll {enrollment.child_first_name ?? "the child"}
        </h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Creates the child record and puts them on the roster — guardians and
          medical details come next on the profile.
        </p>
      </div>

      {state.ok ? (
        <>
          <Notice tone="success">
            <b>Enrolled.</b> They&apos;re on the roster now.
          </Notice>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="enrollment_id" value={enrollment.id} />

          <Field
            label="Child's last name"
            name="last_name"
            defaultValue={guessedLastName}
            required
          />
          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Room</span>
            <select
              name="classroom_id"
              defaultValue=""
              required
              className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-[15px] text-ink outline-none focus:border-primary"
            >
              <option value="" disabled>
                Pick a room
              </option>
              {classrooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
              {pending ? "Enrolling…" : "Enroll"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
