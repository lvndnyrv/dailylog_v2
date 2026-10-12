"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import {
  archiveStaffDocumentAction,
  uploadStaffDocumentAction,
  type StaffDocumentActionState,
} from "@/lib/staff/actions";

export interface StaffPrivateDocument {
  id: string;
  title: string;
  category: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
}

const LABELS: Record<string, string> = {
  staff_private_contract: "Employment contract",
  staff_private_emergency: "Emergency contact form",
  staff_private_review: "Performance review",
  staff_private_other: "Other private record",
};

export function StaffDocumentsCard({
  staffId,
  documents,
  ownerView,
}: {
  staffId: string;
  documents: StaffPrivateDocument[];
  ownerView: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[14px] font-extrabold text-ink">Private documents</h2>
        <span className="flex-1" />
        {ownerView && (
          <button type="button" onClick={() => setOpen(true)} className="text-[12.5px] font-bold text-primary hover:text-primary-hover">
            Upload
          </button>
        )}
      </div>
      {!ownerView ? (
        <p className="text-[12.5px] leading-relaxed text-faint">
          Employment files are restricted to the owner admin.
        </p>
      ) : documents.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-faint">
          No employment files yet. Add contracts, emergency forms or review notes.
        </p>
      ) : (
        <div className="flex flex-col">
          {documents.map((document) => (
            <div key={document.id} className="flex items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-ink">{document.title}</span>
                <span className="block text-[10.5px] text-faint">
                  {LABELS[document.category ?? ""] ?? "Private record"}
                  {document.size_bytes ? ` · ${(document.size_bytes / 1024).toFixed(0)} KB` : ""}
                </span>
              </span>
              <a href={`/documents/${document.id}`} target="_blank" rel="noreferrer" className="text-[11.5px] font-bold text-primary hover:text-primary-hover">
                View
              </a>
              <form action={archiveStaffDocumentAction}>
                <input type="hidden" name="staff_id" value={staffId} />
                <input type="hidden" name="document_id" value={document.id} />
                <button type="submit" className="text-[11.5px] font-bold text-faint hover:text-danger">Archive</button>
              </form>
            </div>
          ))}
          <p className="pt-2 text-[10.5px] text-faint">Visible only to the owner admin · changes are audited</p>
        </div>
      )}
      {open && <UploadStaffDocumentModal staffId={staffId} onClose={() => setOpen(false)} />}
    </section>
  );
}

function UploadStaffDocumentModal({ staffId, onClose }: { staffId: string; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<StaffDocumentActionState, FormData>(
    uploadStaffDocumentAction,
    {},
  );
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [onClose, router, state.ok]);
  return (
    <Modal width={460} onClose={onClose}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Upload a private staff document</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Stored in the private center vault and visible only to the owner admin.
        </p>
      </div>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="staff_id" value={staffId} />
        <label className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-bold text-ink">Document type</span>
          <select name="category" required defaultValue="staff_private_contract" className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3.5 text-[14px] text-ink outline-none focus:border-primary">
            <option value="staff_private_contract">Employment contract</option>
            <option value="staff_private_emergency">Emergency contact form</option>
            <option value="staff_private_review">Performance review</option>
            <option value="staff_private_other">Other private record</option>
          </select>
        </label>
        <Field label="Title" name="title" required placeholder="2026 employment contract" />
        <label className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-bold text-ink">PDF or image</span>
          <input name="file" type="file" required accept="application/pdf,image/*" className="rounded-[13px] border-[1.5px] border-dashed border-[#D6E1F0] bg-canvas px-4 py-4 text-[12.5px] text-muted file:mr-3 file:rounded-full file:border-0 file:bg-tint file:px-3 file:py-1.5 file:font-bold file:text-primary" />
          <span className="text-[10.5px] text-faint">Maximum 10 MB. Uploading the same type archives the previous version.</span>
        </label>
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>{pending ? "Uploading…" : "Upload"}</Button>
        </div>
      </form>
    </Modal>
  );
}
