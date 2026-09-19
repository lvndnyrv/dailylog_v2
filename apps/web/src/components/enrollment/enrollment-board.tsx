"use client";

import type {
  Enrollment,
  EnrollmentChildRow,
  EnrollmentSettings,
  EnrollmentTourSlotRow,
  RoomVacancyReview,
  RoomLiveStatus,
} from "@dailylog/db/queries";
import { ENROLLMENT_STAGES, formatAge } from "@dailylog/shared";
import { ArrowRight, CalendarDays, MoreHorizontal, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  BookTourModal,
  EnrollmentLifecycleModal,
  FamilyApplicationPreviewModal,
  OfferNudgeModal,
  OfferPreviewModal,
  RequestDocumentsModal,
  RoomVacancyReviewModal,
  SendOfferModal,
  TourOutcomeModal,
  TourSlotsModal,
} from "./enrollment-flow-modals";
import { EnrollModal } from "./enroll-modal";
import { NewInquiryModal } from "./new-inquiry-modal";
import { ShareFormPopover } from "./share-form-popover";
import {
  AddToWaitlistModal,
  AlumniModal,
  CloseInquiryModal,
  WaitlistCheckinModal,
  WaitlistRulesModal,
  WithdrawChildModal,
  WithdrawOfferModal,
} from "./waitlist-modals";

const STAGE_LABELS: Record<string, string> = {
  inquiry: "New inquiry",
  tour: "Tour booked",
  application: "Applied",
  offer: "Offer out",
  enrolled: "Enrolled",
  withdrawn: "Closed",
};
const card = "rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card";
type BoardTab = "overview" | "pipeline" | "applications";
type ModalState =
  | "none" | "new" | "share" | "tourSlots" | "rules" | "refresh" | "alumni"
  | "pickTour" | "pickWaitlist" | "pickWithdrawal"
  | { kind: "bookTour" | "familyForm" | "lifecycle" | "documents" | "offer" | "nudge" | "withdrawOffer" | "tourOutcome" | "close" | "preview" | "enroll" | "addWaitlist"; enrollment: Enrollment }
  | { kind: "vacancyOffer"; review: RoomVacancyReview }
  | { kind: "withdrawChild"; child: EnrollmentChildRow };

export function EnrollmentBoard({
  enrollments,
  asOf,
  rooms,
  tourSlots,
  settings,
  enrolledChildren,
  educators,
  daycareId,
  timeZone,
  vacancyReviews,
  centerToday,
  initialModal,
}: {
  enrollments: Enrollment[];
  asOf: string;
  rooms: RoomLiveStatus[];
  tourSlots: EnrollmentTourSlotRow[];
  settings: EnrollmentSettings;
  enrolledChildren: EnrollmentChildRow[];
  educators: { id: string; fullName: string; classroomId: string | null }[];
  daycareId: string;
  timeZone: string;
  vacancyReviews: RoomVacancyReview[];
  centerToday: string;
  initialModal?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<BoardTab>(initialModal === "pipeline" ? "pipeline" : "overview");
  const [modal, setModal] = useState<ModalState>(() => {
    if (initialModal === "new") return "new";
    if (initialModal === "tours") return "tourSlots";
    if (initialModal === "rules") return "rules";
    return "none";
  });
  const closeModal = () => {
    setModal("none");
    if (initialModal) router.replace("/enrollment", { scroll: false });
  };
  const applications = enrollments.filter((item) => item.stage === "application");
  const waitlist = enrollments
    .filter((item) => item.waitlist_status === "active" || (
      item.waitlist_status === "offer"
      && (!item.offer_expires_at || item.offer_expires_at > asOf)
    ))
    .sort((a, b) => (a.waitlist_position ?? 999) - (b.waitlist_position ?? 999));
  const activeChildren = enrolledChildren.filter((child) => !child.archived_at);
  const alumni = enrolledChildren.filter((child) => Boolean(child.archived_at));
  const candidates = enrollments.filter((item) => !["enrolled", "withdrawn"].includes(item.stage));

  return (
    <div className="flex flex-1 flex-col gap-4 p-7 pt-[22px]">
      <div className="flex items-center gap-5 border-b-[1.5px] border-hairline">
        <Tab active={tab === "overview"} onClick={() => setTab("overview")}>Overview</Tab>
        <Tab active={tab === "pipeline"} onClick={() => setTab("pipeline")}>Pipeline</Tab>
        <Tab active={tab === "applications"} onClick={() => setTab("applications")}>Applications{applications.length ? ` · ${applications.length}` : ""}</Tab>
        <span className="mb-2 ml-auto text-[11px] text-faint">every stage move is audit-logged</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setModal("alumni")} className="text-[11.5px] font-bold text-muted hover:text-primary">Alumni · {alumni.length}</button>
        <button type="button" onClick={() => setModal("pickWithdrawal")} className="text-[11.5px] font-bold text-muted hover:text-primary">Schedule a withdrawal</button>
        <span className="flex-1" />
        <button type="button" onClick={() => setModal("tourSlots")} className="rounded-full border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2 text-[12.5px] font-bold text-ink hover:bg-canvas">Tour calendar</button>
        <button type="button" onClick={() => setModal("pickTour")} className="rounded-full border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2 text-[12.5px] font-bold text-ink hover:bg-canvas">Book a tour</button>
        <div className="relative">
          <button type="button" onClick={() => setModal(modal === "share" ? "none" : "share")} className="rounded-full border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2 text-[12.5px] font-bold text-ink hover:bg-canvas">Share inquiry form</button>
          {modal === "share" && <ShareFormPopover daycareId={daycareId} onClose={closeModal} />}
        </div>
        <button type="button" onClick={() => setModal("new")} className="rounded-full bg-primary px-[18px] py-2 text-[12.5px] font-bold text-white hover:bg-primary-hover">+ Add a family</button>
      </div>

      {tab === "overview" && (
        <EnrollmentOverview
          enrollments={enrollments}
          asOf={asOf}
          rooms={rooms}
          vacancyReviews={vacancyReviews}
          waitlist={waitlist}
          tourSlots={tourSlots}
          onPipeline={() => setTab("pipeline")}
          onMakeOffer={(enrollment) => setModal({ kind: "offer", enrollment })}
          onNudge={(enrollment) => setModal({ kind: "nudge", enrollment })}
          onWithdrawOffer={(enrollment) => setModal({ kind: "withdrawOffer", enrollment })}
          onPreview={(enrollment) => setModal({ kind: "preview", enrollment })}
          onApplication={(enrollment) => router.push(`/enrollment/${enrollment.id}`)}
          onRules={() => setModal("rules")}
          onRefresh={() => setModal("refresh")}
          onAddWaitlist={() => setModal("pickWaitlist")}
          onTours={() => setModal("tourSlots")}
          onReviewVacancy={(review) => setModal({ kind: "vacancyOffer", review })}
        />
      )}

      {tab === "pipeline" && (
        <PipelineBoard
          enrollments={enrollments}
          onBookTour={(enrollment) => setModal({ kind: "bookTour", enrollment })}
          onTourOutcome={(enrollment) => setModal({ kind: "tourOutcome", enrollment })}
          onApplication={(enrollment) => router.push(`/enrollment/${enrollment.id}`)}
          onOffer={(enrollment) => setModal({ kind: "offer", enrollment })}
          onNudge={(enrollment) => setModal({ kind: "nudge", enrollment })}
          onLifecycle={(enrollment) => setModal({ kind: "lifecycle", enrollment })}
          onEnroll={(enrollment) => setModal({ kind: "enroll", enrollment })}
          onClose={(enrollment) => setModal({ kind: "close", enrollment })}
        />
      )}

      {tab === "applications" && (
        <ApplicationsList applications={applications} rooms={rooms} onOpen={(enrollment) => router.push(`/enrollment/${enrollment.id}`)} onDocuments={(enrollment) => setModal({ kind: "documents", enrollment })} onOffer={(enrollment) => setModal({ kind: "offer", enrollment })} />
      )}

      {modal === "new" && <NewInquiryModal classrooms={rooms} onClose={closeModal} />}
      {modal === "tourSlots" && <TourSlotsModal slots={tourSlots} classrooms={rooms} educators={educators} timeZone={timeZone} onClose={closeModal} />}
      {modal === "rules" && <WaitlistRulesModal settings={settings} onClose={closeModal} />}
      {modal === "refresh" && <WaitlistCheckinModal families={waitlist} settings={settings} onClose={closeModal} />}
      {modal === "alumni" && <AlumniModal alumni={alumni} rooms={rooms} onClose={closeModal} />}
      {modal === "pickTour" && <FamilyPicker title="Book a tour" subtitle="Choose an active family, then select an open time and host." enrollments={candidates} onPick={(enrollment) => setModal({ kind: "bookTour", enrollment })} onClose={closeModal} />}
      {modal === "pickWaitlist" && <FamilyPicker title="Add to waitlist" subtitle="Choose a family before assigning their ranked room list." enrollments={candidates.filter((item) => item.waitlist_status === "not_waitlisted")} onPick={(enrollment) => setModal({ kind: "addWaitlist", enrollment })} onClose={closeModal} />}
      {modal === "pickWithdrawal" && <ChildPicker items={activeChildren} onPick={(child) => setModal({ kind: "withdrawChild", child })} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "bookTour" && <BookTourModal enrollment={modal.enrollment} slots={tourSlots} educators={educators} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "familyForm" && <FamilyApplicationPreviewModal enrollment={modal.enrollment} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "lifecycle" && <EnrollmentLifecycleModal enrollment={modal.enrollment} educators={educators} centerToday={centerToday} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "documents" && <RequestDocumentsModal enrollment={modal.enrollment} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "offer" && <SendOfferModal enrollment={modal.enrollment} rooms={rooms} defaultWindow={settings.offer_window_hours} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "vacancyOffer" && <RoomVacancyReviewModal review={modal.review} defaultWindow={settings.offer_window_hours} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "nudge" && <OfferNudgeModal enrollment={modal.enrollment} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "withdrawOffer" && <WithdrawOfferModal enrollment={modal.enrollment} nextFamily={nextWaitlisted(waitlist, modal.enrollment)} reviewNext={settings.auto_offer} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "tourOutcome" && <TourOutcomeModal enrollment={modal.enrollment} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "close" && <CloseInquiryModal enrollment={modal.enrollment} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "preview" && <OfferPreviewModal enrollment={modal.enrollment} roomName={rooms.find((room) => room.id === modal.enrollment.classroom_id)?.name ?? "Program"} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "enroll" && <EnrollModal enrollment={modal.enrollment} classrooms={rooms} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "addWaitlist" && <AddToWaitlistModal enrollment={modal.enrollment} rooms={rooms} waitlist={waitlist} onClose={closeModal} />}
      {typeof modal === "object" && modal.kind === "withdrawChild" && <WithdrawChildModal child={modal.child} waitlist={waitlist} onClose={closeModal} />}
    </div>
  );
}

function EnrollmentOverview({
  enrollments, asOf, rooms, vacancyReviews, waitlist, tourSlots, onPipeline, onMakeOffer, onNudge, onWithdrawOffer, onPreview, onApplication, onRules, onRefresh, onAddWaitlist, onTours, onReviewVacancy,
}: {
  enrollments: Enrollment[]; asOf: string; rooms: RoomLiveStatus[]; vacancyReviews: RoomVacancyReview[]; waitlist: Enrollment[]; tourSlots: EnrollmentTourSlotRow[];
  onPipeline: () => void; onMakeOffer: (item: Enrollment) => void; onNudge: (item: Enrollment) => void; onWithdrawOffer: (item: Enrollment) => void; onPreview: (item: Enrollment) => void; onApplication: (item: Enrollment) => void; onRules: () => void; onRefresh: () => void; onAddWaitlist: () => void; onTours: () => void; onReviewVacancy: (review: RoomVacancyReview) => void;
}) {
  const offer = enrollments.find((item) => item.stage === "offer"
    && ["sent", "viewed"].includes(item.offer_status)
    && !item.offer_accepted_at
    && (!item.offer_expires_at || item.offer_expires_at > asOf));
  const upcomingTours = tourSlots.filter((item) => item.status === "booked" && new Date(item.starts_at) > new Date()).slice(0, 3);
  const active = enrollments.filter((item) => item.stage !== "withdrawn");
  return (
    <div className="flex flex-col gap-4">
      {vacancyReviews.length > 0 && (
        <section className="rounded-2xl border-[1.5px] border-[#EFCF94] bg-[#FFFDF8] p-4" aria-labelledby="released-spots-heading">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#FBF3E4] text-lg" aria-hidden>↗</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="released-spots-heading" className="text-[15px] font-extrabold text-ink">Newly available spots</h2>
                <span className="rounded-full bg-[#FBF3E4] px-2 py-1 text-[10px] font-bold text-[#A86D13]">Admin review required</span>
              </div>
              <p className="mt-0.5 text-[10.5px] text-muted">A completed room move or closed offer released capacity. Nothing is sent until you review the live match and offer terms.</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 xl:grid-cols-2">
            {vacancyReviews.map((review) => {
              const family = review.candidate_guardian_name?.split(" ").slice(-1)[0] ?? "No match yet";
              const candidate = review.candidate_enrollment_id
                ? `${family} · ${review.candidate_child_first_name ?? "Child"}`
                : review.blocking_reason ?? "No eligible family yet";
              return (
                <div key={review.id} className="flex items-center gap-3 rounded-[13px] border border-[#EFD9B5] bg-card px-3.5 py-3">
                  <span className="min-w-0 flex-1">
                    <b className="block text-[12.5px] text-ink">{review.room_name} · open {formatDate(review.available_on)}</b>
                    <span className="block truncate text-[10.5px] text-muted">{candidate}</span>
                    <span className="block text-[9.5px] text-faint">Released by {review.moved_child_name} · {review.active_waitlist_count} waiting</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onReviewVacancy(review)}
                    className={`shrink-0 rounded-full px-3 py-2 text-[10.5px] font-bold ${review.candidate_enrollment_id ? "bg-primary text-white hover:bg-primary-hover" : "border-[1.5px] border-[#D6E1F0] text-muted hover:bg-canvas"}`}
                  >
                    {review.candidate_enrollment_id ? "Review offer" : "Review gap"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {rooms.map((room) => {
          const waiting = waitlist.filter((item) => item.classroom_id === room.id).length;
          const spots = Math.max(0, Number(room.capacity ?? 0) - Number(room.enrolled_count));
          const percentage = room.capacity ? Math.min(100, (Number(room.enrolled_count) / room.capacity) * 100) : 0;
          return <div key={room.id} className={`${card} p-3.5`}><div className="flex items-baseline gap-2"><b className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{room.name}</b><span className="text-[11px] font-bold text-ink">{room.enrolled_count}<span className="text-faint">/{room.capacity ?? "—"}</span></span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EDF3FB]"><span className={`block h-full rounded-full ${spots ? "bg-success" : "bg-[#D8A248]"}`} style={{ width: `${percentage}%` }} /></div><b className={`mt-2 block text-[10.5px] ${spots ? "text-success" : "text-[#A86D13]"}`}>{spots ? `${spots} spot${spots === 1 ? "" : "s"} open${room.opens_on ? ` ${formatDate(room.opens_on)}` : " now"}` : `Full${room.opens_on ? ` · next ${formatDate(room.opens_on)}` : ""}`}</b><span className="text-[10px] text-faint">{waiting ? `${waiting} waiting` : "No waitlist"}</span></div>;
        })}
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_340px]">
        <section className={`${card} overflow-hidden`} aria-labelledby="waitlist-h">
          <div className="flex items-center gap-2 border-b border-[#EDF3FB] px-4 py-3.5"><div><h2 id="waitlist-h" className="text-[15px] font-extrabold text-ink">Waitlist</h2><p className="text-[10.5px] text-faint">Ranked by priority tier, then sign-up date</p></div><span className="rounded-full bg-tint px-2 py-1 text-[10.5px] font-bold text-primary">{waitlist.length} families</span><span className="flex-1" /><button type="button" onClick={onRefresh} className="text-[11px] font-bold text-primary hover:underline">Check in</button><button type="button" onClick={onRules} className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"><SlidersHorizontal size={12} /> Rules</button><button type="button" onClick={onAddWaitlist} className="rounded-full bg-primary px-3 py-1.5 text-[10.5px] font-bold text-white">+ Add</button></div>
          <div className="grid grid-cols-[34px_1.6fr_.6fr_.8fr_.8fr_1fr] gap-2 bg-[#F8FBFE] px-4 py-2 text-[9.5px] font-bold tracking-[.07em] text-faint"><span>#</span><span>FAMILY · CHILD</span><span>AGE</span><span>ROOM</span><span>START</span><span>STATUS</span></div>
          {waitlist.slice(0, 8).map((item) => <div key={item.id} className="grid grid-cols-[34px_1.6fr_.6fr_.8fr_.8fr_1fr] items-center gap-2 border-t border-[#EDF3FB] px-4 py-3 text-[11.5px]"><b className="text-ink">{item.waitlist_position ?? "—"}</b><button type="button" onClick={() => onApplication(item)} className="min-w-0 text-left"><b className="block truncate text-[12px] text-ink">{familyName(item)} · {item.child_first_name ?? "Child"}</b><span className="block truncate text-[10px] text-faint">{item.waitlist_priority === "sibling" ? "Sibling priority · " : ""}{waitDuration(item.waitlist_joined_at ?? item.created_at)}</span></button><span className="text-muted">{item.child_date_of_birth ? formatAge(item.child_date_of_birth) : "—"}</span><span className="truncate text-muted">{rooms.find((room) => room.id === item.classroom_id)?.name ?? "—"}</span><span className="text-muted">{item.desired_start_date ? formatDate(item.desired_start_date) : "Open"}</span><span>{item.waitlist_status === "offer" ? <button type="button" onClick={() => onNudge(item)} className="rounded-full bg-[#FFF3DD] px-2 py-1 text-[10px] font-bold text-[#A86D13]">Offer out · nudge</button> : <button type="button" onClick={() => onMakeOffer(item)} className="rounded-full border-[1.5px] border-[#D6E1F0] px-2 py-1 text-[10px] font-bold text-primary">Make offer</button>}</span></div>)}
          {waitlist.length === 0 && <p className="px-4 py-8 text-center text-[12px] text-faint">No active waitlist families yet.</p>}
        </section>
        <aside className="flex flex-col gap-4">
          <section className={`${card} p-4`}><div className="flex items-center gap-2"><h2 className="text-[14px] font-extrabold text-ink">Open offer</h2>{offer && <span className="rounded-full bg-[#FFF3DD] px-2 py-0.5 text-[10px] font-bold text-[#A86D13]">expires {offer.offer_expires_at ? relativeDeadline(offer.offer_expires_at) : "soon"}</span>}</div>{offer ? <><button type="button" onClick={() => onPreview(offer)} className="mt-3 flex w-full items-center gap-2 text-left"><Avatar name={offer.guardian_name ?? "Family"} size={32} /><span className="flex-1"><b className="block text-[12.5px] text-ink">{familyName(offer)} · {offer.child_first_name}</b><span className="text-[10.5px] text-muted">{rooms.find((room) => room.id === offer.classroom_id)?.name ?? "Program"} · {offer.desired_start_date ? formatDate(offer.desired_start_date) : "start open"}</span></span><ArrowRight size={14} className="text-primary" /></button><div className="mt-3 flex gap-2"><button type="button" onClick={() => onNudge(offer)} className="flex-1 rounded-full bg-primary py-2 text-[10.5px] font-bold text-white">Nudge family</button><button type="button" onClick={() => onWithdrawOffer(offer)} className="flex-1 rounded-full border-[1.5px] border-[#D6E1F0] py-2 text-[10.5px] font-bold text-danger">Withdraw</button></div></> : <p className="mt-2 text-[11.5px] text-faint">No offer is currently holding a spot.</p>}</section>
          <section className={`${card} p-4`}><div className="flex items-center gap-2"><CalendarDays size={15} className="text-primary" /><h2 className="text-[14px] font-extrabold text-ink">Tours this week</h2><button type="button" onClick={onTours} className="ml-auto text-[10.5px] font-bold text-primary">Open calendar</button></div><div className="mt-2 flex flex-col gap-2">{upcomingTours.map((slot) => <div key={slot.id} className="flex gap-2 border-b border-[#EDF3FB] pb-2 text-[11px] last:border-0"><b className="w-20 text-ink">{formatShortDateTime(slot.starts_at)}</b><span className="min-w-0 flex-1 text-muted">{slot.enrollment ? familyNameFromName(slot.enrollment.guardian_name) : "Family"} · {slot.classroom?.name ?? "Program"}<span className="block text-[9.5px] text-faint">host: {slot.host?.full_name ?? "assign needed"}</span></span></div>)}{upcomingTours.length === 0 && <p className="text-[11px] text-faint">No booked tours coming up.</p>}</div></section>
          <section className={`${card} p-4`}><h2 className="text-[14px] font-extrabold text-ink">Pipeline · last 30 days</h2><div className="mt-2 grid grid-cols-2 gap-2">{[["Inquiries", active.filter((item) => item.stage === "inquiry").length], ["Tours", active.filter((item) => item.stage === "tour").length], ["Offers", active.filter((item) => item.stage === "offer").length], ["Enrolled", active.filter((item) => item.stage === "enrolled").length]].map(([label, count]) => <button key={String(label)} type="button" onClick={onPipeline} className="rounded-[11px] bg-canvas p-2 text-left"><b className="block text-[16px] text-ink">{count}</b><span className="text-[9.5px] text-muted">{label}</span></button>)}</div></section>
        </aside>
      </div>
    </div>
  );
}

function PipelineBoard({ enrollments, onBookTour, onTourOutcome, onApplication, onOffer, onNudge, onLifecycle, onEnroll, onClose }: { enrollments: Enrollment[]; onBookTour: (item: Enrollment) => void; onTourOutcome: (item: Enrollment) => void; onApplication: (item: Enrollment) => void; onOffer: (item: Enrollment) => void; onNudge: (item: Enrollment) => void; onLifecycle: (item: Enrollment) => void; onEnroll: (item: Enrollment) => void; onClose: (item: Enrollment) => void }) {
  const columns = ENROLLMENT_STAGES.filter((stage) => stage !== "withdrawn");
  return <div className="grid flex-1 grid-cols-5 items-start gap-3">{columns.map((stage) => { const cards = enrollments.filter((item) => item.stage === stage); return <div key={stage} className="flex flex-col gap-2"><div className="flex items-center gap-2 px-1"><b className="text-[12px] text-ink">{STAGE_LABELS[stage]}</b><span className="grid size-5 place-items-center rounded-full bg-tint text-[10px] font-bold text-primary">{cards.length}</span></div>{cards.map((item) => <PipelineCard key={item.id} item={item} onBookTour={onBookTour} onTourOutcome={onTourOutcome} onApplication={onApplication} onOffer={onOffer} onNudge={onNudge} onLifecycle={onLifecycle} onEnroll={onEnroll} onClose={onClose} />)}{cards.length === 0 && <div className="rounded-2xl border border-dashed border-[#D6E1F0] px-3 py-6 text-center text-[10.5px] text-faint">Empty</div>}</div>; })}</div>;
}

function PipelineCard({ item, onBookTour, onTourOutcome, onApplication, onOffer, onNudge, onLifecycle, onEnroll, onClose }: { item: Enrollment; onBookTour: (item: Enrollment) => void; onTourOutcome: (item: Enrollment) => void; onApplication: (item: Enrollment) => void; onOffer: (item: Enrollment) => void; onNudge: (item: Enrollment) => void; onLifecycle: (item: Enrollment) => void; onEnroll: (item: Enrollment) => void; onClose: (item: Enrollment) => void }) {
  const accepted = item.stage === "offer" && Boolean(item.offer_accepted_at);
  const readyToEnroll = accepted
    && item.offer_status === "accepted"
    && ((item.offer_deposit_cents ?? 0) === 0 || item.deposit_status === "paid")
    && Boolean(item.application_submitted_at && item.agreement_signed_at);
  const action = item.stage === "inquiry" ? () => onBookTour(item) : item.stage === "tour" ? () => item.tour_at ? onTourOutcome(item) : onBookTour(item) : item.stage === "application" ? () => onApplication(item) : item.stage === "offer" ? () => accepted ? onLifecycle(item) : onNudge(item) : () => onLifecycle(item);
  const label = item.stage === "inquiry" ? "Book a tour →" : item.stage === "tour" ? item.tour_at ? "Log outcome →" : "Book a tour →" : item.stage === "application" ? "Review →" : item.stage === "offer" ? accepted ? "View onboarding →" : "Nudge →" : "Open lifecycle →";
  return <div className={`${card} flex flex-col gap-1 p-3`}><b className="truncate text-[12.5px] text-ink">{familyName(item)} · {item.child_first_name ?? "Child"}</b><span className="text-[10.5px] text-muted">{item.child_date_of_birth ? `${formatAge(item.child_date_of_birth)} · ` : ""}{item.desired_start_date ? `wants ${formatDate(item.desired_start_date)}` : "start date open"}</span><span className="text-[9.5px] text-faint">{item.stage === "tour" && item.tour_at ? `Tour ${formatShortDateTime(item.tour_at)}` : item.stage === "application" ? `Application ${item.application_progress}%` : item.stage === "offer" && accepted ? "Family onboarding in progress" : item.stage === "offer" && item.offer_expires_at ? `Expires ${relativeDeadline(item.offer_expires_at)}` : `Via ${item.source ?? "other"}`}</span><button type="button" onClick={action} className="mt-2 w-full rounded-full border-[1.5px] border-[#D6E1F0] py-1.5 text-[10.5px] font-bold text-primary hover:bg-canvas">{label}</button>{item.stage === "application" && <button type="button" onClick={() => onOffer(item)} className="text-[10px] font-bold text-primary">Send offer</button>}{readyToEnroll && <button type="button" onClick={() => onEnroll(item)} className="text-[10px] font-bold text-success">Ready · complete enrollment</button>}{item.stage !== "enrolled" && <button type="button" onClick={() => onClose(item)} className="self-end text-[9.5px] font-bold text-faint hover:text-danger" aria-label={`Close ${familyName(item)} inquiry`}><MoreHorizontal size={14} /></button>}</div>;
}

function ApplicationsList({ applications, rooms, onOpen, onDocuments, onOffer }: { applications: Enrollment[]; rooms: RoomLiveStatus[]; onOpen: (item: Enrollment) => void; onDocuments: (item: Enrollment) => void; onOffer: (item: Enrollment) => void }) {
  return <div className="grid gap-3 xl:grid-cols-2">{applications.map((item) => { const docs = documentCount(item.documents_status); const room = rooms.find((candidate) => candidate.id === item.classroom_id); return <div key={item.id} className={`${card} flex items-center gap-3 p-4`}><Avatar name={item.guardian_name ?? "Family"} size={38} /><button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left"><b className="block truncate text-[13px] text-ink">{familyName(item)} · {item.child_first_name ?? "Child"}</b><span className="block text-[11px] text-muted">{room?.name ?? "Program open"} · wants {item.desired_start_date ? formatDate(item.desired_start_date) : "flexible start"}</span><span className="block text-[10px] text-faint">Application {item.application_progress}% · documents {docs.received}/{docs.total}</span></button><button type="button" onClick={() => onDocuments(item)} className="rounded-full border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-[10.5px] font-bold text-primary">Documents</button><button type="button" onClick={() => onOffer(item)} className="rounded-full bg-primary px-3 py-1.5 text-[10.5px] font-bold text-white">Make offer</button></div>; })}{applications.length === 0 && <p className="rounded-2xl border border-dashed border-[#D6E1F0] px-4 py-10 text-center text-[12px] text-faint">No applications in review.</p>}</div>;
}

function FamilyPicker({ title, subtitle, enrollments, onPick, onClose }: { title: string; subtitle: string; enrollments: Enrollment[]; onPick: (item: Enrollment) => void; onClose: () => void }) { return <Modal onClose={onClose} width={430}><div><h2 className="text-[19px] font-extrabold text-ink">{title}</h2><p className="text-[12.5px] text-muted">{subtitle}</p></div><div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto">{enrollments.map((item) => <button key={item.id} type="button" onClick={() => onPick(item)} className={`${card} flex items-center gap-3 p-3 text-left hover:border-primary hover:bg-tint`}><Avatar name={item.guardian_name ?? "Family"} size={34} /><span className="min-w-0 flex-1"><b className="block truncate text-[12.5px] text-ink">{familyName(item)} · {item.child_first_name ?? "Child"}</b><span className="text-[10.5px] capitalize text-muted">{STAGE_LABELS[item.stage] ?? item.stage} · {item.source ?? "other"}</span></span><ArrowRight size={14} className="text-primary" /></button>)}{enrollments.length === 0 && <p className="rounded-[13px] bg-canvas p-5 text-center text-[12px] text-faint">No eligible families.</p>}</div><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></Modal>; }
function ChildPicker({ items, onPick, onClose }: { items: EnrollmentChildRow[]; onPick: (item: EnrollmentChildRow) => void; onClose: () => void }) { return <Modal onClose={onClose} width={430}><div><h2 className="text-[19px] font-extrabold text-ink">Schedule a withdrawal</h2><p className="text-[12.5px] text-muted">Choose the enrolled child whose last day was provided.</p></div><div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto">{items.map((child) => <button key={child.id} type="button" onClick={() => onPick(child)} className={`${card} flex items-center gap-3 p-3 text-left hover:border-primary hover:bg-tint`}><Avatar name={`${child.first_name} ${child.last_name}`} size={34} /><span className="min-w-0 flex-1"><b className="block truncate text-[12.5px] text-ink">{child.first_name} {child.last_name}</b><span className="text-[10.5px] text-muted">{child.classroom?.name ?? "No room"}{child.enrolled_on ? ` · enrolled ${formatDate(child.enrolled_on)}` : ""}</span></span><ArrowRight size={14} className="text-primary" /></button>)}</div><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></Modal>; }

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`border-b-[2.5px] pb-2 text-[13px] ${active ? "border-primary font-bold text-primary" : "border-transparent font-semibold text-faint hover:text-muted"}`}>{children}</button>; }
function familyName(item: Enrollment): string { return item.guardian_name?.split(" ").slice(-1)[0] ?? "Family"; }
function familyNameFromName(value: string | null): string { return value?.split(" ").slice(-1)[0] ?? "Family"; }
function nextWaitlisted(waitlist: Enrollment[], current: Enrollment): Enrollment | undefined { return waitlist.filter((item) => item.id !== current.id && item.classroom_id === current.classroom_id && item.waitlist_status === "active").sort((a, b) => (a.waitlist_position ?? 999) - (b.waitlist_position ?? 999))[0]; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function formatShortDateTime(value: string): string { return new Intl.DateTimeFormat("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function relativeDeadline(value: string): string { const hours = Math.ceil((new Date(value).getTime() - Date.now()) / 3600000); if (hours <= 0) return "expired"; if (hours < 24) return `in ${hours}h`; return `in ${Math.ceil(hours / 24)}d`; }
function waitDuration(value: string | null): string { if (!value) return "joined recently"; const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000)); return days < 31 ? `waiting ${Math.max(1, days)} days` : `waiting ${Math.floor(days / 30)} months`; }
function documentCount(value: unknown) {
  const data = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const statuses = ["immunization", "emergency_contacts", "medical", "handbook"].map((key) => {
    const raw = data[key];
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? String((raw as Record<string, unknown>).status ?? "missing")
      : String(raw ?? "missing");
  });
  return { received: statuses.filter((item) => item === "received").length, total: statuses.length };
}
