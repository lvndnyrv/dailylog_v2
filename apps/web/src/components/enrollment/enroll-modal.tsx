"use client";

import type { Enrollment, RoomLiveStatus } from "@dailylog/db/queries";
import { useActionState } from "react";
import { enrollAction, type EnrollmentActionState } from "@/lib/enrollment/actions";
import { Button } from "@/components/ui/button";
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
  classrooms: RoomLiveStatus[];
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
  const acceptedRoom = classrooms.find((room) => room.id === enrollment.classroom_id);
  const depositReady = (enrollment.offer_deposit_cents ?? 0) === 0 || enrollment.deposit_status === "paid";
  const ready = Boolean(
    enrollment.offer_status === "accepted"
      && enrollment.offer_accepted_at
      && enrollment.application_submitted_at
      && enrollment.agreement_signed_at
      && depositReady
      && acceptedRoom,
  );
  const lastNameError = state.fieldErrors?.last_name;

  return (
    <Modal onClose={onClose} width={400}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">
          Enroll {enrollment.child_first_name ?? "the child"}
        </h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Finalizes the accepted room and restores the family&apos;s application
          details on the child profile in one step.
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
          <input type="hidden" name="classroom_id" value={enrollment.classroom_id ?? ""} />

          <label className="flex min-w-0 flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Child&apos;s last name <span className="text-danger">*</span></span>
            <input
              name="last_name"
              defaultValue={guessedLastName}
              required
              aria-invalid={Boolean(lastNameError)}
              aria-describedby={lastNameError ? "enroll-last-name-error" : undefined}
              className={`min-w-0 w-full rounded-[13px] border-[1.5px] bg-card px-4 py-3.5 text-[15px] text-ink outline-none focus:border-primary ${lastNameError ? "border-danger" : "border-[#D6E1F0]"}`}
            />
            {lastNameError && <span id="enroll-last-name-error" className="text-[10.5px] text-danger">{lastNameError}</span>}
          </label>

          <div className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5">
            <span className="block text-[10.5px] font-bold uppercase tracking-[.07em] text-faint">Accepted room</span>
            <b className="mt-1 block text-[14px] text-ink">{acceptedRoom?.name ?? "Room missing"}</b>
            {acceptedRoom && <span className="text-[11px] text-muted">{acceptedRoom.enrolled_count}/{acceptedRoom.capacity} places currently allocated · the database rechecks the first-day count</span>}
          </div>

          <div className="rounded-[13px] bg-canvas px-3.5 py-3 text-[11.5px] leading-relaxed text-ink">
            <ReadinessLine ready={Boolean(enrollment.offer_accepted_at)}>Family accepted the offer</ReadinessLine>
            <ReadinessLine ready={depositReady}>Required deposit recorded</ReadinessLine>
            <ReadinessLine ready={Boolean(enrollment.application_submitted_at && enrollment.agreement_signed_at)}>Application and agreement complete</ReadinessLine>
          </div>

          {state.error && <Notice tone="error">{state.error}</Notice>}

          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending || !ready}>
              {pending ? "Enrolling…" : "Enroll"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ReadinessLine({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return <span className="flex gap-2 py-1"><b className={ready ? "text-success" : "text-[#A86D13]"}>{ready ? "✓" : "—"}</b>{children}</span>;
}
