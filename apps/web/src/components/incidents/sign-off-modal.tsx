"use client";

import type { IncidentRow } from "@dailylog/db/queries";
import { formatAge } from "@dailylog/shared";
import { useActionState } from "react";
import { signOffIncidentAction, type IncidentActionState } from "@/lib/incidents/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

const label = "font-mono text-[10.5px] font-bold tracking-[.08em] text-faint";

// Incident sign-off 9b — your signature locks the report; it lands in the
// incident log and the family's file.
export function SignOffModal({
  incident,
  onClose,
}: {
  incident: IncidentRow;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<IncidentActionState, FormData>(
    signOffIncidentAction,
    {},
  );

  const childName = `${incident.child?.first_name ?? ""} ${incident.child?.last_name ?? ""}`.trim();

  return (
    <Modal onClose={onClose} width={430}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[19px] font-extrabold text-ink">Sign off — incident report</h2>
          <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
            Written by {incident.educator?.full_name ?? "an educator"} ·{" "}
            {new Date(incident.occurred_at).toLocaleTimeString("en-CA", {
              hour: "numeric",
              minute: "2-digit",
            })}
            {incident.classroom ? ` · ${incident.classroom.name} room` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close incident review"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-lg leading-none text-muted transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          ×
        </button>
      </div>

      <div className="flex items-center gap-2.5 rounded-[13px] bg-canvas px-3.5 py-3">
        <Avatar name={childName} size={34} />
        <span className="text-[13px] font-bold text-ink">
          {childName}
          <span className="font-semibold text-muted">
            {incident.classroom ? ` · ${incident.classroom.name}` : ""}
            {incident.child?.date_of_birth ? ` · ${formatAge(incident.child.date_of_birth)}` : ""}
          </span>
        </span>
      </div>

      <div>
        <span className={label}>WHAT HAPPENED</span>
        <p className="mt-1 text-[12.5px] leading-relaxed text-body">{incident.description}</p>
      </div>
      <div>
        <span className={label}>CARE GIVEN</span>
        <p className="mt-1 text-[12.5px] leading-relaxed text-body">{incident.first_aid_given}</p>
      </div>

      {state.ok ? (
        <>
          <Notice tone="success">
            <b>Signed &amp; filed.</b> The family sees it in their app.
          </Notice>
          <Button type="button" className="py-3 text-sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="incident_id" value={incident.id} />
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <Button type="submit" disabled={pending} className="py-3.5 text-[15px]">
            {pending ? "Signing…" : "Sign & file the report"}
          </Button>
          {incident.child?.id && (
            <a
              href={`/messages?child=${incident.child.id}`}
              className="text-center text-[12.5px] font-bold text-primary hover:text-primary-hover"
            >
              Message the family first
            </a>
          )}
        </form>
      )}

      <p className="text-center text-[11.5px] leading-normal text-faint">
        Your signature locks the report — it lands in the incident log and the
        family&apos;s file. Edits after signing show as corrections.
      </p>
    </Modal>
  );
}
