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
type BoardTab = "overview" | "pipeline" | "applications";

function OverviewTab({
  enrollments,
  onPipeline,
}: {
  enrollments: Enrollment[];
  onPipeline: () => void;
}) {
  const active = enrollments.filter((e) => e.stage !== "withdrawn");
  const byStage = (stage: string) => active.filter((e) => e.stage === stage).length;
  const sources = new Map<string, number>();
  for (const e of active) {
    const key = e.source ?? "other";
    sources.set(key, (sources.get(key) ?? 0) + 1);
  }

  const tile = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
  const label = "font-mono text-[10.5px] font-semibold tracking-[.08em] text-faint";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-3">
        <button type="button" onClick={onPipeline} className={`${tile} text-left hover:bg-[#F8FBFE]`}>
          <span className={label}>NEW INQUIRIES</span>
          <span className="mt-1 block text-[24px] font-extrabold text-ink">
            {byStage("inquiry")}
          </span>
          <span className="text-[11.5px] text-muted">waiting for a first reply</span>
        </button>
        <button type="button" onClick={onPipeline} className={`${tile} text-left hover:bg-[#F8FBFE]`}>
          <span className={label}>TOURS BOOKED</span>
          <span className="mt-1 block text-[24px] font-extrabold text-ink">{byStage("tour")}</span>
          <span className="text-[11.5px] text-muted">show them the rooms</span>
        </button>
        <button type="button" onClick={onPipeline} className={`${tile} text-left hover:bg-[#F8FBFE]`}>
          <span className={label}>OFFERS OUT</span>
          <span className="mt-1 block text-[24px] font-extrabold text-ink">{byStage("offer")}</span>
          <span className="text-[11.5px] text-muted">waiting on families</span>
        </button>
        <div className={tile}>
          <span className={label}>ENROLLED FROM PIPELINE</span>
          <span className="mt-1 block text-[24px] font-extrabold text-success">
            {byStage("enrolled")}
          </span>
          <span className="text-[11.5px] text-muted">on the roster</span>
        </div>
      </div>

      <div className={`${tile} max-w-md`}>
        <span className="text-[13px] font-extrabold text-ink">Where families come from</span>
        <div className="mt-2 flex flex-col gap-1.5">
          {[...sources.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([source, count]) => (
              <div key={source} className="flex items-center gap-2 text-[12.5px]">
                <span className="w-20 capitalize text-muted">{source}</span>
                <span className="h-2 rounded-full bg-primary/70" style={{ width: `${count * 36}px` }} />
                <span className="font-bold text-ink">{count}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

const boardTabClass = (active: boolean) =>
  `border-b-[2.5px] pb-2 text-[13px] ${
    active
      ? "border-[var(--primary)] font-bold text-primary"
      : "border-transparent font-semibold text-faint hover:text-muted"
  }`;

export function EnrollmentBoard({
  enrollments,
  classrooms,
  daycareId,
}: {
  enrollments: Enrollment[];
  classrooms: { id: string; name: string }[];
  daycareId: string;
}) {
  const [tab, setTab] = useState<BoardTab>("pipeline");
  const [modal, setModal] = useState<
    "none" | "new" | "share" | { enroll: Enrollment }
  >("none");

  const columns = ENROLLMENT_STAGES.filter((stage) => stage !== "withdrawn");
  const withdrawnCount = enrollments.filter((e) => e.stage === "withdrawn").length;
  const applications = enrollments.filter((e) => e.stage === "application");

  const nextStage = (stage: string) => {
    const order = ["inquiry", "tour", "application", "offer"];
    const index = order.indexOf(stage);
    return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-7">
      <div className="flex items-center gap-5 border-b-[1.5px] border-hairline">
        <button type="button" className={boardTabClass(tab === "overview")} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button type="button" className={boardTabClass(tab === "pipeline")} onClick={() => setTab("pipeline")}>
          Pipeline
        </button>
        <button
          type="button"
          className={boardTabClass(tab === "applications")}
          onClick={() => setTab("applications")}
        >
          Applications{applications.length ? ` · ${applications.length}` : ""}
        </button>
        <span className="mb-2 ml-auto text-[11px] text-faint">
          every stage move is logged
        </span>
      </div>

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

      {tab === "overview" && (
        <OverviewTab enrollments={enrollments} onPipeline={() => setTab("pipeline")} />
      )}

      {tab === "applications" && (
        <div className="flex max-w-xl flex-col gap-2.5">
          {applications.length === 0 && (
            <p className="rounded-2xl border border-dashed border-[#D6E1F0] px-4 py-8 text-center text-[12.5px] text-faint">
              No applications in review.
            </p>
          )}
          {applications.map((card) => (
            <div
              key={card.id}
              className="flex items-center gap-3 rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-4"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-extrabold text-ink">
                  {card.guardian_name}
                  {card.child_first_name ? ` · ${card.child_first_name}` : ""}
                </span>
                <span className="block text-[11.5px] text-muted">
                  {card.guardian_email ?? "no email"}
                  {card.guardian_phone ? ` · ${card.guardian_phone}` : ""}
                </span>
                <span className="block text-[11.5px] text-faint">
                  {card.child_date_of_birth ? `${formatAge(card.child_date_of_birth)} · ` : ""}
                  {card.desired_start_date
                    ? `hoping to start ${new Date(`${card.desired_start_date}T12:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
                    : "start date open"}
                </span>
              </span>
              <form action={setStageAction}>
                <input type="hidden" name="enrollment_id" value={card.id} />
                <input type="hidden" name="stage" value="offer" />
                <button
                  type="submit"
                  className="rounded-btn bg-primary px-4 py-2 text-[12.5px] font-bold text-white hover:bg-primary-hover"
                >
                  Make offer →
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      {tab === "pipeline" && (
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
      )}

      {tab === "pipeline" && withdrawnCount > 0 && (
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
