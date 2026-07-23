"use client";

import type { Certification, StaffRow } from "@dailylog/db/queries";
import { useActionState, useState } from "react";
import { updateStaffAction, type StaffActionState } from "@/lib/staff/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

// Edit staff profile 4i: employment record + certification rows. Name/email
// belong to the person (their own profile); the admin edits the employment side.
export function EditStaffModal({
  member,
  onClose,
}: {
  member: StaffRow;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<StaffActionState, FormData>(
    updateStaffAction,
    {},
  );
  const [certs, setCerts] = useState<Certification[]>(
    (member.certifications ?? []).length > 0
      ? member.certifications
      : [{ item: "", issuer: null, issued: null, expires_on: null }],
  );

  return (
    <Modal onClose={onClose} width={560}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">
          Edit {member.profile!.full_name}&apos;s record
        </h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Employment details and certifications. They edit their own name and
          contact info from their app.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="staff_id" value={member.id} />

        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Job title"
            name="job_title"
            defaultValue={member.job_title ?? ""}
            placeholder="Lead educator"
          />
          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-bold text-ink">Employment</span>
            <select
              name="employment_type"
              defaultValue={member.employment_type ?? ""}
              className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-[15px] text-ink outline-none focus:border-primary"
            >
              <option value="">—</option>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="casual">Casual</option>
              <option value="contract">Contract</option>
            </select>
          </label>
        </div>

        <Field
          label="Start date"
          name="started_on"
          type="date"
          defaultValue={member.started_on ?? ""}
        />

        <fieldset className="min-w-0 flex flex-col gap-2">
          <legend className="text-[13px] font-bold text-ink">Certifications</legend>
          {certs.map((cert, i) => (
            <div
              key={i}
              className="grid min-w-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,.9fr)_minmax(0,.9fr)_24px] items-center gap-1.5"
            >
              <input
                name="cert_item"
                defaultValue={cert.item}
                placeholder="First Aid"
                aria-label="Certification"
                className="min-w-0 w-full rounded-[10px] border-[1.5px] border-[#D6E1F0] bg-card px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-primary"
              />
              <input
                name="cert_issuer"
                defaultValue={cert.issuer ?? ""}
                placeholder="Red Cross"
                aria-label="Issuer"
                className="min-w-0 w-full rounded-[10px] border-[1.5px] border-[#D6E1F0] bg-card px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-primary"
              />
              <input
                name="cert_issued"
                type="date"
                defaultValue={cert.issued ?? ""}
                aria-label="Issued"
                className="min-w-0 w-full rounded-[10px] border-[1.5px] border-[#D6E1F0] bg-card px-2 py-2 text-[11.5px] text-ink outline-none focus:border-primary"
              />
              <input
                name="cert_expires"
                type="date"
                defaultValue={cert.expires_on ?? ""}
                aria-label="Expires"
                className="min-w-0 w-full rounded-[10px] border-[1.5px] border-[#D6E1F0] bg-card px-2 py-2 text-[11.5px] text-ink outline-none focus:border-primary"
              />
              <button
                type="button"
                aria-label="Remove row"
                onClick={() => setCerts((rows) => rows.filter((_, j) => j !== i))}
                className="text-faint hover:text-danger"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setCerts((rows) => [...rows, { item: "", issuer: null, issued: null, expires_on: null }])
            }
            className="self-start text-[12.5px] font-bold text-primary hover:text-primary-hover"
          >
            + Add certification
          </button>
        </fieldset>

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
            {pending ? "Saving…" : "Save record"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
