"use client";

import type { StaffCredentialSubmissionRow } from "@dailylog/db/queries";
import { useActionState } from "react";
import {
  reviewCredentialSubmissionAction,
  type CredentialReviewActionState,
} from "@/lib/staff/actions";
import { Notice } from "@/components/ui/notice";

export type CredentialSubmissionWithUrl = StaffCredentialSubmissionRow & {
  documentUrl: string | null;
};

export function CredentialReviewCard({
  submission,
}: {
  submission: CredentialSubmissionWithUrl;
}) {
  const [state, action, pending] = useActionState<CredentialReviewActionState, FormData>(
    reviewCredentialSubmissionAction,
    {},
  );
  const isPending = submission.status === "pending";

  return (
    <form action={action} className="rounded-[14px] border border-[#D6E1F0] bg-[#F9FBFE] p-3.5">
      <input type="hidden" name="submission_id" value={submission.id} />
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#E3EDFA] text-[17px]">
          {submission.document?.mime_type === "application/pdf" ? "PDF" : "▧"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-extrabold text-ink">
            {submission.credential?.name ?? "Credential renewal"}
          </span>
          <span className="mt-0.5 block text-[11.5px] text-muted">
            {submission.issuer} · completed {shortDate(submission.completed_on)} · expires{" "}
            {shortDate(submission.expires_on)}
          </span>
          <span className="mt-0.5 block text-[11px] text-faint">
            Submitted by {submission.submitter?.full_name ?? "educator"} ·{" "}
            {new Date(submission.created_at).toLocaleString("en-CA", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </span>
        {submission.documentUrl ? (
          <a
            href={submission.documentUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[12px] font-bold text-primary hover:text-primary-hover"
          >
            Open file ↗
          </a>
        ) : null}
      </div>

      {isPending ? (
        <>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-[11.5px] font-bold text-muted">
              Note to educator <span className="font-normal text-faint">(required when requesting changes)</span>
            </span>
            <textarea
              name="review_notes"
              rows={2}
              maxLength={500}
              placeholder="What needs to be corrected?"
              className="resize-none rounded-[11px] border-[1.5px] border-[#D6E1F0] bg-white px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-primary"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              name="decision"
              value="rejected"
              disabled={pending}
              className="flex-1 rounded-btn border-[1.5px] border-[#EFC9C9] px-3 py-2 text-[12.5px] font-bold text-danger hover:bg-danger-bg disabled:opacity-50"
            >
              Request changes
            </button>
            <button
              type="submit"
              name="decision"
              value="approved"
              disabled={pending}
              className="flex-1 rounded-btn bg-primary px-3 py-2 text-[12.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {pending ? "Saving…" : "Verify renewal"}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-3 flex items-start gap-2 rounded-[10px] bg-white px-3 py-2">
          <span className={`text-[12px] font-bold ${submission.status === "approved" ? "text-success" : "text-danger"}`}>
            {submission.status === "approved" ? "Verified" : "Changes requested"}
          </span>
          <span className="text-[11.5px] text-muted">
            by {submission.reviewer?.full_name ?? "director"}
            {submission.review_notes ? ` · ${submission.review_notes}` : ""}
          </span>
        </div>
      )}

      {state.ok && <div className="mt-3"><Notice tone="success">Review saved.</Notice></div>}
      {state.error && <div className="mt-3"><Notice tone="error">{state.error}</Notice></div>}
    </form>
  );
}

function shortDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
