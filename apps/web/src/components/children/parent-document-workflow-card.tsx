"use client";

import type { ParentDocumentRequestReviewRow } from "@dailylog/db/queries";
import Link from "next/link";
import { useActionState } from "react";
import { Notice } from "@/components/ui/notice";
import {
  createParentDocumentRequestAction,
  reviewParentDocumentSubmissionAction,
  type ChildActionState,
} from "@/lib/children/actions";

const field =
  "w-full rounded-[11px] border-[1.5px] border-[#D6E1F0] bg-white px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-primary";

export function ParentDocumentWorkflowCard({
  childId,
  childName,
  requests,
}: {
  childId: string;
  childName: string;
  requests: ParentDocumentRequestReviewRow[];
}) {
  const [state, action, pending] = useActionState<ChildActionState, FormData>(
    createParentDocumentRequestAction,
    {},
  );
  const active = requests.filter((request) =>
    ["requested", "under_review", "rejected"].includes(request.status),
  );

  return (
    <section id="family-documents" className="scroll-mt-28 rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]" aria-labelledby="family-documents-h">
      <div className="mb-3 flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <h2 id="family-documents-h" className="text-[14px] font-extrabold text-ink">
            Family document requests
          </h2>
          <span className="mt-0.5 block text-[11.5px] text-faint">
            Request, review and return missing records without email attachments.
          </span>
        </span>
        {active.length > 0 && (
          <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[11px] font-bold text-warning-text">
            {active.length} active
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {active.map((request) => (
          <RequestRow key={request.id} childId={childId} request={request} />
        ))}
        {active.length === 0 && (
          <p className="rounded-xl bg-canvas px-3.5 py-3 text-[12px] text-faint">
            No outstanding family documents for {childName}.
          </p>
        )}
      </div>

      <details className="group mt-3 rounded-xl border border-dashed border-[#D6E1F0] bg-[#F9FBFE]">
        <summary className="cursor-pointer list-none px-3.5 py-3 text-[12.5px] font-bold text-primary marker:hidden">
          <span className="group-open:hidden">+ Request a document</span>
          <span className="hidden group-open:inline">New request</span>
        </summary>
        <form action={action} className="grid gap-2.5 border-t border-[#E6EDF7] p-3.5">
          <input type="hidden" name="child_id" value={childId} />
          <label className="grid gap-1">
            <span className="text-[11.5px] font-bold text-muted">Document type</span>
            <select name="kind" required defaultValue="immunization" className={field}>
              <option value="immunization">Updated immunization record</option>
              <option value="allergy_medical">Allergy &amp; medical form</option>
              <option value="birth_certificate">Birth certificate</option>
              <option value="custody">Custody document</option>
              <option value="emergency_contact">Emergency contact form</option>
              <option value="other">Other document</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-[11.5px] font-bold text-muted">
              Custom title <span className="font-normal text-faint">(required only for Other)</span>
            </span>
            <input name="title" maxLength={160} placeholder="e.g. Updated custody order" className={field} />
          </label>
          <label className="grid gap-1">
            <span className="text-[11.5px] font-bold text-muted">Note to family</span>
            <textarea name="message" rows={2} maxLength={2000} placeholder="What should the family send?" className={`${field} resize-none`} />
          </label>
          <label className="grid gap-1">
            <span className="text-[11.5px] font-bold text-muted">Due date</span>
            <input type="date" name="due_on" className={field} />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-btn bg-primary px-3 py-2.5 text-[12.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {pending ? "Sending request…" : `Send request to ${childName}'s family`}
          </button>
          {state.ok && <Notice tone="success">The request is now visible in the parent app.</Notice>}
          {state.error && <Notice tone="error">{state.error}</Notice>}
        </form>
      </details>
    </section>
  );
}

function RequestRow({
  childId,
  request,
}: {
  childId: string;
  request: ParentDocumentRequestReviewRow;
}) {
  const pendingSubmission = request.submissions
    .filter((submission) => submission.status === "under_review")
    .sort((left, right) => right.submitted_at.localeCompare(left.submitted_at))[0];

  if (request.status === "under_review" && pendingSubmission) {
    return (
      <ReviewSubmissionForm
        childId={childId}
        request={request}
        submissionId={pendingSubmission.id}
      />
    );
  }

  const rejected = request.status === "rejected";
  return (
    <div className={`rounded-[14px] border p-3.5 ${rejected ? "border-[#EFC9C9] bg-danger-bg" : "border-[#F0E2C4] bg-warning-bg"}`}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="mt-0.5 text-[16px]">{rejected ? "↻" : "◷"}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-extrabold text-ink">{request.title}</span>
          <span className={`mt-0.5 block text-[11.5px] ${rejected ? "text-danger" : "text-warning-text"}`}>
            {rejected
              ? `Replacement requested${request.rejection_reason ? ` · ${request.rejection_reason}` : ""}`
              : `Waiting for family${request.due_on ? ` · due ${shortDate(request.due_on)}` : ""}`}
          </span>
        </span>
        <span className={`rounded-full px-2.5 py-[3px] text-[10.5px] font-bold ${rejected ? "bg-white text-danger" : "bg-white text-warning-text"}`}>
          {rejected ? "Needs replacement" : "Requested"}
        </span>
      </div>
    </div>
  );
}

function ReviewSubmissionForm({
  childId,
  request,
  submissionId,
}: {
  childId: string;
  request: ParentDocumentRequestReviewRow;
  submissionId: string;
}) {
  const [state, action, pending] = useActionState<ChildActionState, FormData>(
    reviewParentDocumentSubmissionAction,
    {},
  );

  return (
    <form
      id={`family-document-${request.id}`}
      action={action}
      className="scroll-mt-28 rounded-[14px] border border-[#BCD5F4] bg-[#F4F8FE] p-3.5"
    >
      <input type="hidden" name="child_id" value={childId} />
      <input type="hidden" name="submission_id" value={submissionId} />
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#E3EDFA] text-[15px]">▧</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-extrabold text-ink">{request.title}</span>
          <span className="mt-0.5 block text-[11.5px] text-muted">
            Uploaded {request.submitted_at ? dateTime(request.submitted_at) : "recently"} · ready for review
          </span>
        </span>
        {request.latest_document && (
          <Link
            href={`/documents/${request.latest_document.id}`}
            target="_blank"
            className="text-[11.5px] font-bold text-primary hover:underline"
          >
            Open file ↗
          </Link>
        )}
      </div>
      <label className="mt-3 grid gap-1">
        <span className="text-[11.5px] font-bold text-muted">
          Note to family <span className="font-normal text-faint">(required when requesting another copy)</span>
        </span>
        <textarea name="reason" rows={2} maxLength={1000} placeholder="e.g. The child's name or latest vaccine date is cut off." className={`${field} resize-none`} />
      </label>
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          name="decision"
          value="rejected"
          disabled={pending}
          className="flex-1 rounded-btn border-[1.5px] border-[#EFC9C9] bg-white px-3 py-2 text-[12px] font-bold text-danger hover:bg-danger-bg disabled:opacity-50"
        >
          Request another copy
        </button>
        <button
          type="submit"
          name="decision"
          value="accepted"
          disabled={pending}
          className="flex-1 rounded-btn bg-primary px-3 py-2 text-[12px] font-bold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? "Saving…" : "Accept document"}
        </button>
      </div>
      {state.ok && <div className="mt-3"><Notice tone="success">Review saved and the family was notified.</Notice></div>}
      {state.error && <div className="mt-3"><Notice tone="error">{state.error}</Notice></div>}
    </form>
  );
}

function shortDate(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
