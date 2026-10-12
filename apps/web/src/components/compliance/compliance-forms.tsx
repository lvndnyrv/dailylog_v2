"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Upload } from "lucide-react";
import type {
  ComplianceDocument,
  ComplianceInspectionPack,
} from "@dailylog/db/queries";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  logComplianceDrill,
  uploadComplianceDocument,
  voidComplianceDrill,
} from "@/lib/compliance/actions";
import {
  input,
  label,
  link,
  date,
  time,
  documentTypes,
  drillTypes,
  ModalTitle,
  ErrorMessage,
} from "./shared";

export function UploadModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: ComplianceDocument | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [watch, setWatch] = useState(existing?.watch_expiry ?? true);
  return (
    <Modal
      onClose={() => {
        if (!pending) onClose();
      }}
      width={500}
    >
      <ModalTitle
        title={existing ? "Replace document" : "Add to the vault"}
        onClose={() => {
          if (!pending) onClose();
        }}
      />
      <p className="text-sm text-muted">
        Licenses, insurance, inspection reports — the originals live here.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(async () => {
            setError("");
            try {
              const result = await uploadComplianceDocument(form);
              if (result.error) setError(result.error);
              else onSaved();
            } catch {
              setError(
                "Upload could not finish. Check the vault before retrying.",
              );
            }
          });
        }}
      >
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
          <input type="hidden" name="replaces_id" value={existing?.id ?? ""} />
          <label
            className={`${label} rounded-xl border-[1.5px] border-dashed border-hairline bg-canvas p-4`}
          >
            <span className="flex items-center gap-2">
              <Upload size={18} />
              Choose a file (required)
            </span>
            <input
              className="mt-3 block w-full min-w-0 text-xs font-normal file:mr-2 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-2 file:text-primary"
              type="file"
              name="file"
              accept="application/pdf,image/jpeg,image/png"
              required
            />
            <span className="mt-2 block text-xs font-normal text-muted">
              PDF, JPEG or PNG · up to 10 MB
            </span>
          </label>
          <label className={label}>
            Title (required)
            <input
              className={input}
              name="title"
              defaultValue={existing?.title}
              maxLength={180}
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Type
              <select
                className={input}
                name="category"
                defaultValue={existing?.category ?? "license"}
              >
                {Object.entries(documentTypes).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Expires{watch ? " (required)" : ""}
              <input
                className={input}
                name="expires_on"
                type="date"
                defaultValue={existing?.expires_on ?? ""}
                required={watch}
              />
            </label>
          </div>
          <label className="flex items-center justify-between gap-4 text-sm text-ink">
            <span>
              <strong className="block">Watch the expiry</strong>
              <span className="text-xs text-muted">
                Appears in Expiring soon 60 days before expiry.
              </span>
            </span>
            <input
              type="checkbox"
              name="watch_expiry"
              checked={watch}
              onChange={(e) => setWatch(e.target.checked)}
              className="size-5 accent-primary"
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm text-ink">
            <span>
              <strong className="block">Include in inspector shares</strong>
              <span className="text-xs text-muted">
                Current version only · read-only, time-limited access.
              </span>
            </span>
            <input
              type="checkbox"
              name="include_in_inspection"
              defaultChecked={existing?.include_in_inspection ?? true}
              className="size-5 accent-primary"
            />
          </label>
        </fieldset>
        <ErrorMessage error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save document"}
          </Button>
        </div>
        <p className="text-center text-xs leading-relaxed text-faint">
          Replacing a document keeps the old version. Cancel does not upload or
          change any saved document.
        </p>
      </form>
    </Modal>
  );
}

function nextDrill(day: string, kind: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const month = d.getUTCMonth() + (kind === "fire" ? 1 : 3);
  const original = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(month);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(original, last));
  return d.toISOString().slice(0, 10);
}
export function DrillModal({
  pack,
  onClose,
  onSaved,
}: {
  pack: ComplianceInspectionPack;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [kind, setKind] = useState("fire");
  const [schedule, setSchedule] = useState(true);
  const [day, setDay] = useState(pack.today);
  const [due, setDue] = useState(nextDrill(pack.today, "fire"));
  return (
    <Modal
      onClose={() => {
        if (!pending) onClose();
      }}
      width={550}
    >
      <ModalTitle
        title="Log a drill"
        onClose={() => {
          if (!pending) onClose();
        }}
      />
      <p className="text-sm text-muted">
        Record the actual headcount at the muster point. Times use{" "}
        {pack.timezone}.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(async () => {
            setError("");
            try {
              const r = await logComplianceDrill(form);
              if (r.error) setError(r.error);
              else onSaved();
            } catch {
              setError(
                "Could not confirm the save. Check drill history before retrying.",
              );
            }
          });
        }}
      >
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
          <input type="hidden" name="kind" value={kind} />
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Drill type"
          >
            {Object.entries(drillTypes).map(([v, t]) => (
              <button
                type="button"
                aria-pressed={kind === v}
                key={v}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold ${kind === v ? "border-primary bg-primary text-white" : "border-hairline text-muted"}`}
                onClick={() => {
                  setKind(v);
                  setDue(nextDrill(day, v));
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <label className={label}>
            Started (required)
            <input
              className={input}
              type="datetime-local"
              name="conducted_local"
              defaultValue={`${pack.today}T10:00`}
              required
              onChange={(e) => {
                const d = e.target.value.slice(0, 10);
                if (d) {
                  setDay(d);
                  setDue(nextDrill(d, kind));
                }
              }}
            />
          </label>
          <label className={label}>
            Led by (required)
            <select
              className={input}
              name="lead_staff_id"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Select staff lead
              </option>
              {pack.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Duration · minutes
              <input
                className={input}
                name="minutes"
                type="number"
                min="0"
                max="1440"
                required
                defaultValue="2"
              />
            </label>
            <label className={label}>
              Seconds
              <input
                className={input}
                name="seconds"
                type="number"
                min="0"
                max="59"
                required
                defaultValue="0"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Children accounted for (required)
              <input
                className={input}
                name="children_count"
                type="number"
                min="0"
                max="10000"
                required
              />
            </label>
            <label className={label}>
              Staff accounted for (required)
              <input
                className={input}
                name="staff_count"
                type="number"
                min="1"
                max="10000"
                required
              />
            </label>
          </div>
          <p className="rounded-xl bg-canvas p-3 text-xs leading-relaxed text-muted">
            On save, headcounts are compared with check-ins and staff clock-ins
            at the drill’s start time. If they differ, explain why below (for
            example, visitors or missing clock-ins).
          </p>
          <label className={label}>
            Notes
            <textarea
              className={input}
              rows={3}
              name="notes"
              maxLength={4000}
              placeholder="What went well, issues, or headcount differences"
            />
          </label>
          <label className="flex items-center justify-between text-sm font-bold text-ink">
            Schedule the next drill
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={schedule}
              onChange={(e) => setSchedule(e.target.checked)}
            />
          </label>
          {schedule && (
            <label className={label}>
              Next due date
              <input
                className={input}
                type="date"
                name="next_due_on"
                value={due}
                min={day}
                required
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
          )}
          <p className="text-xs text-faint">
            Suggested interval: fire monthly; other drills quarterly. Adjust to
            your center’s policy and local requirements.
          </p>
        </fieldset>
        <ErrorMessage error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button disabled={pending}>
            {pending ? "Saving…" : "Save to drill log"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DrillHistoryModal({
  pack,
  onClose,
  canEdit,
}: {
  pack: ComplianceInspectionPack;
  onClose: () => void;
  canEdit: boolean;
}) {
  const [correction, setCorrection] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <Modal onClose={onClose} width={740}>
      <ModalTitle title="Drill history · last 12 months" onClose={onClose} />
      <p className="text-sm text-muted">
        Incorrect entries can be voided with a reason, then logged again.
        Nothing is deleted.
      </p>
      <ErrorMessage error={error} />
      {!pack.drills.length && (
        <p className="text-sm text-faint">No drill records yet.</p>
      )}
      {pack.drills.map((d) => (
        <article
          key={d.id}
          className={`rounded-xl border border-hairline p-4 ${d.voided_at ? "bg-canvas" : ""}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-ink">
                {drillTypes[d.kind]} · {time(d.conducted_at, pack.timezone)}
              </h3>
              <p className="mt-1 text-xs text-muted">
                Led by {d.lead_name} · {Math.floor(d.duration_seconds / 60)}m{" "}
                {d.duration_seconds % 60}s
              </p>
            </div>
            {d.voided_at ? (
              <span className="text-xs font-bold text-danger">Voided</span>
            ) : (
              <button
                disabled={!canEdit}
                className="text-xs font-bold text-danger"
                onClick={() => {
                  setCorrection(d.id);
                  setReason("");
                }}
              >
                Correct entry
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-ink">
            Accounted for: {d.children_count} children + {d.staff_count} staff.
            Attendance at logging: {d.attendance_children} children +{" "}
            {d.attendance_staff} clocked-in staff.
          </p>
          {d.notes && (
            <p className="mt-2 whitespace-pre-wrap text-xs text-muted">
              {d.notes}
            </p>
          )}
          {d.next_due_on && (
            <p className="mt-2 text-xs text-faint">
              Next due {date(d.next_due_on)}
            </p>
          )}
          {d.void_reason && (
            <p className="mt-2 text-xs text-danger">
              Correction: {d.void_reason}
            </p>
          )}
          {correction === d.id && (
            <form
              className="mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  try {
                    const r = await voidComplianceDrill(d.id, reason);
                    if (r.error) setError(r.error);
                    else setCorrection(null);
                  } catch {
                    setError("Unable to void this drill. Please retry.");
                  }
                });
              }}
            >
              <label className={label}>
                Reason for voiding
                <input
                  className={input}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={5}
                  maxLength={500}
                  required
                />
              </label>
              <div className="mt-2 flex gap-3">
                <Button disabled={pending} className="text-xs">
                  Void this entry
                </Button>
                <button
                  type="button"
                  className={link}
                  onClick={() => setCorrection(null)}
                >
                  Keep entry
                </button>
              </div>
            </form>
          )}
        </article>
      ))}
      <Link href="/compliance/inspection" className={link}>
        Print history in the inspection pack →
      </Link>
    </Modal>
  );
}
