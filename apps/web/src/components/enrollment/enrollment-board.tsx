"use client";

import type { Enrollment } from "@dailylog/db/queries";
import { ENROLLMENT_STAGES, formatAge } from "@dailylog/shared";
import { useState } from "react";
import { setStageAction } from "@/lib/enrollment/actions";
import { EnrollModal } from "./enroll-modal";
import { NewInquiryModal } from "./new-inquiry-modal";
import { ShareFormPopover } from "./share-form-popover";

const STAGE_LABELS: Record<string, string> = {
  inquiry: "New inquiry",
  tour: "Tour booked",
  application: "Application",
  offer: "Offer out",
  enrolled: "Enrolled",
  withdrawn: "Withdrawn",
};

// Kanban-style pipeline (2d). Moves happen through explicit actions rather
// than drag & drop — same information, keyboard-reachable (DECISIONS.md).
export function EnrollmentBoard({
  enrollments,
  classrooms,
  daycareId,
}: {
  enrollments: Enrollment[];
  classrooms: { id: string; name: string }[];
  daycareId: string;
}) {
  const [modal, setModal] = useState<
    "none" | "new" | "share" | { enroll: Enrollment }
  >("none");

  const columns = ENROLLMENT_STAGES.filter((stage) => stage !== "withdrawn");
  const withdrawnCount = enrollments.filter((e) => e.stage === "withdrawn").length;

  const nextStage = (stage: string) => {
    const order = ["inquiry", "tour", "application", "offer"];
    const index = order.indexOf(stage);
    return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-7">
      <div className="flex items-center gap-2">
        <span className="flex-1" />
        <div className="relative">
          <button
            type="button"
            onClick={() => setModal(modal === "share" ? "none" : "share")}
            className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2 text-[13px] font-bold text-ink hover:bg-canvas"
          >
            Share inquiry form
          </button>
          {modal === "share" && (
            <ShareFormPopover daycareId={daycareId} onClose={() => setModal("none")} />
          )}
        </div>
        <button
          type="button"
          onClick={() => setModal("new")}
          className="rounded-btn bg-primary px-[18px] py-2 text-[13px] font-bold text-white hover:bg-primary-hover"
        >
          + New inquiry
        </button>
      </div>

      <div className="grid flex-1 grid-cols-5 items-start gap-3">
        {columns.map((stage) => {
          const cards = enrollments.filter((e) => e.stage === stage);
          return (
            <div key={stage} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-[12.5px] font-extrabold text-ink">
                  {STAGE_LABELS[stage]}
                </span>
                <span className="grid size-5 place-items-center rounded-full bg-tint text-[10.5px] font-bold text-primary">
                  {cards.length}
                </span>
              </div>

              {cards.map((card) => (
                <div
                  key={card.id}
                  className="flex flex-col gap-1 rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-3"
                >
                  <span className="text-[13px] font-extrabold text-ink">
                    {(card.guardian_name ?? "Family").split(" ").slice(-1)[0]}
                    {card.child_first_name ? ` · ${card.child_first_name}` : ""}
                  </span>
                  <span className="text-[11px] text-muted">
                    {card.child_date_of_birth ? `${formatAge(card.child_date_of_birth)} · ` : ""}
                    {card.desired_start_date
                      ? `starts ${new Date(`${card.desired_start_date}T12:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
                      : "start date open"}
                  </span>
                  <span className="text-[10.5px] text-faint">
                    Via {card.source ?? "—"}
                    {card.created_at
                      ? ` · ${new Date(card.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
                      : ""}
                  </span>

                  {stage !== "enrolled" && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {stage === "offer" ? (
                        <button
                          type="button"
                          onClick={() => setModal({ enroll: card })}
                          className="flex-1 rounded-btn bg-primary px-2 py-1.5 text-[11px] font-bold text-white hover:bg-primary-hover"
                        >
                          Enroll →
                        </button>
                      ) : (
                        <form action={setStageAction} className="flex-1">
                          <input type="hidden" name="enrollment_id" value={card.id} />
                          <input type="hidden" name="stage" value={nextStage(stage) ?? ""} />
                          <button
                            type="submit"
                            className="w-full rounded-btn border-[1.5px] border-[#D6E1F0] px-2 py-1.5 text-[11px] font-bold text-primary hover:bg-canvas"
                          >
                            {stage === "inquiry"
                              ? "Book a tour →"
                              : stage === "tour"
                                ? "Application →"
                                : "Make offer →"}
                          </button>
                        </form>
                      )}
                      <form action={setStageAction}>
                        <input type="hidden" name="enrollment_id" value={card.id} />
                        <input type="hidden" name="stage" value="withdrawn" />
                        <button
                          type="submit"
                          title="Withdraw"
                          aria-label={`Withdraw ${card.guardian_name}`}
                          className="rounded-btn border-[1.5px] border-transparent px-1.5 py-1.5 text-[11px] font-bold text-faint hover:border-[#EFC9C9] hover:text-danger"
                        >
                          ✕
                        </button>
                      </form>
                    </div>
                  )}
                  {stage === "enrolled" && (
                    <span className="mt-1 self-start rounded-full bg-[#E4F3EC] px-2 py-[2px] text-[10.5px] font-bold text-success">
                      In the roster ✓
                    </span>
                  )}
                </div>
              ))}

              {cards.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[#D6E1F0] px-3 py-6 text-center text-[11px] text-faint">
                  Empty
                </div>
              )}
            </div>
          );
        })}
      </div>

      {withdrawnCount > 0 && (
        <p className="text-[11.5px] text-faint">
          {withdrawnCount} withdrawn — kept on record.
        </p>
      )}

      {modal === "new" && <NewInquiryModal onClose={() => setModal("none")} />}
      {typeof modal === "object" && "enroll" in modal && (
        <EnrollModal
          enrollment={modal.enroll}
          classrooms={classrooms}
          onClose={() => setModal("none")}
        />
      )}
    </div>
  );
}
