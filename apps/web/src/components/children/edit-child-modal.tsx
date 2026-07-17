"use client";

import type { ChildPickup, PendingParentInvite, Tables } from "@dailylog/db";
import { CONSENT_KINDS, type EmergencyContact } from "@dailylog/shared";
import { useActionState, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import {
  addPickupAction,
  archiveChildAction,
  inviteParentAction,
  removePickupAction,
  setConsentAction,
  unlinkParentAction,
  updateChildAction,
  type ChildActionState,
} from "@/lib/children/actions";

type Guardian = {
  relationship: string | null;
  is_primary: boolean;
  parent: { id: string; full_name: string; email: string; phone: string | null } | null;
};

type Medication = {
  id: string;
  name: string;
  dosage: string;
  schedule: string | null;
  active: boolean;
  parent: { full_name: string } | null;
};

type Consent = { id: string; kind: string; granted: boolean };

const TABS = ["Details", "Medical", "Medications", "Family & pickups", "Consents"] as const;
type Tab = (typeof TABS)[number];

const FORM_ID = "edit-child-record";
const label = "text-[13px] font-bold text-ink";
const input =
  "rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[14px] text-ink outline-none placeholder:text-faint focus:border-primary";
const sectionLabel = "font-mono text-[10.5px] font-bold tracking-[.08em] text-faint";

// Edit child profile 19d — the tabbed console record: Details, Medical,
// Medications, Family & pickups, Consents. Mirrors the fields the educator
// edits on mobile (13a) so both apps stay one record.
export function EditChildModal({
  child,
  classrooms,
  pickups,
  medications,
  consents,
  guardians,
  pendingInvites,
  onClose,
}: {
  child: Tables<"children">;
  classrooms: { id: string; name: string }[];
  pickups: ChildPickup[];
  medications: Medication[];
  consents: Consent[];
  guardians: Guardian[];
  pendingInvites: PendingParentInvite[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("Details");
  const [room, setRoom] = useState(child.classroom_id ?? "");
  const [state, action, pending] = useActionState<ChildActionState, FormData>(
    updateChildAction,
    {},
  );
  const cardRef = useRef<HTMLDivElement>(null);

  const initialContacts = (
    Array.isArray(child.emergency_contacts) ? child.emergency_contacts : []
  ) as unknown as EmergencyContact[];
  const [contacts, setContacts] = useState<EmergencyContact[]>(
    initialContacts.length > 0 ? initialContacts : [{ name: "", relation: "", phone: "" }],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    cardRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const name = `${child.first_name} ${child.last_name}`;
  const roomName = classrooms.find((c) => c.id === room)?.name;
  const shown = (t: Tab) => (tab === t ? "" : "hidden");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${name}`}
        tabIndex={-1}
        className="flex max-h-full w-[720px] max-w-full flex-col overflow-hidden rounded-[22px] border border-[rgba(23,51,91,.12)] bg-card outline-none"
        style={{ boxShadow: "0 14px 40px rgba(23,51,91,.16)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#EDF3FB] px-6 py-4">
          <Avatar name={name} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block text-[18px] font-extrabold text-ink">Edit profile</span>
            <span className="block text-[12px] text-muted">
              {name}
              {roomName ? ` · ${roomName}` : ""}
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 flex-none place-items-center rounded-full bg-canvas text-[13px] text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-5 border-b border-[#EDF3FB] px-6">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`border-b-[2.5px] py-3 text-[13px] ${
                tab === t
                  ? "border-[var(--primary)] font-bold text-primary"
                  : "border-transparent font-semibold text-faint hover:text-muted"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* ── Record form: Details + Medical + Emergency contacts ─────── */}
          <form id={FORM_ID} action={action} className="flex flex-col gap-5">
            <input type="hidden" name="child_id" value={child.id} />
            <input type="hidden" name="classroom_id" value={room} />

            {/* DETAILS */}
            <div className={`flex flex-col gap-4 ${shown("Details")}`}>
              <div className="flex items-center gap-3.5">
                <Avatar name={name} size={56} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-ink">Profile photo</span>
                  <span className="block text-[11.5px] leading-normal text-muted">
                    Shown to educators at check-in and pickup. Square image, at least 240px.
                  </span>
                  <span className="mt-1.5 flex items-center gap-3">
                    <button
                      type="button"
                      disabled
                      title="Photo upload arrives with the storage/document work"
                      className="rounded-btn bg-tint px-3 py-1.5 text-[12px] font-bold text-primary/60"
                    >
                      Upload photo
                    </button>
                    <button type="button" disabled className="text-[12px] font-semibold text-faint">
                      Remove
                    </button>
                  </span>
                </span>
              </div>

              <span className={sectionLabel}>DETAILS</span>
              <div className="grid grid-cols-2 gap-3">
                <LabeledInput label="First name" name="first_name" defaultValue={child.first_name} required />
                <LabeledInput label="Last name" name="last_name" defaultValue={child.last_name} required />
                <LabeledInput
                  label="Preferred name (optional)"
                  name="preferred_name"
                  defaultValue={child.preferred_name ?? ""}
                  placeholder="Davey"
                />
                <LabeledInput
                  label="Pronouns (optional)"
                  name="pronouns"
                  defaultValue={child.pronouns ?? ""}
                  placeholder="he / him"
                />
                <LabeledInput
                  label="Date of birth"
                  name="date_of_birth"
                  type="date"
                  defaultValue={child.date_of_birth ?? ""}
                />
                <LabeledInput
                  label="Enrollment date"
                  name="enrolled_on"
                  type="date"
                  defaultValue={child.enrolled_on ?? ""}
                />
              </div>
              <LabeledInput
                label="Home address"
                name="home_address"
                defaultValue={child.home_address ?? ""}
                placeholder="Street, city, postal code"
              />

              <span className={sectionLabel}>ROOM &amp; SCHEDULE</span>
              <div className="flex flex-wrap gap-1.5">
                {classrooms.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={room === c.id}
                    onClick={() => setRoom(c.id)}
                    className={`rounded-[13px] border-[1.5px] px-4 py-2.5 text-[13px] font-bold ${
                      room === c.id
                        ? "border-[var(--primary)] bg-primary text-white"
                        : "border-[#D6E1F0] bg-card text-ink hover:bg-canvas"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="rounded-[13px] bg-canvas px-3.5 py-3">
                <div className="flex gap-1.5">
                  {["MON", "TUE", "WED", "THU", "FRI"].map((d) => (
                    <span
                      key={d}
                      className="flex-1 rounded-lg border border-[#E4ECF6] bg-card py-1.5 text-center"
                    >
                      <span className="block text-[9.5px] font-bold tracking-[.06em] text-faint">
                        {d}
                      </span>
                      <span className="block text-[11px] font-semibold text-faint">—</span>
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-faint">
                  Recurring weekly schedules aren&apos;t built yet — attendance is tracked day
                  by day.
                </p>
              </div>
            </div>

            {/* MEDICAL */}
            <div className={`flex flex-col gap-4 ${shown("Medical")}`}>
              <span className={sectionLabel}>MEDICAL &amp; ALLERGIES</span>
              <LabeledInput
                label="Allergies (comma-separated)"
                name="allergies"
                defaultValue={(child.allergies ?? []).join(", ")}
                placeholder="Peanuts, Dairy"
              />
              <label className="flex flex-col gap-[7px]">
                <span className={label}>Medical notes</span>
                <textarea
                  name="medical_notes"
                  defaultValue={child.medical_notes ?? ""}
                  rows={4}
                  placeholder="EpiPen location, asthma, anything educators must know…"
                  className={`${input} leading-relaxed`}
                />
              </label>
              <LabeledInput
                label="Dietary needs (optional)"
                name="dietary_needs"
                defaultValue={child.dietary_needs ?? ""}
                placeholder="e.g. no pork, vegetarian"
              />
            </div>

            {/* EMERGENCY CONTACTS (part of Family & pickups tab, but a record field) */}
            <div className={`flex flex-col gap-3 ${shown("Family & pickups")}`}>
              <span className={sectionLabel}>EMERGENCY CONTACTS</span>
              {contacts.map((c, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2.5 rounded-[14px] border-[1.5px] border-[#EDF3FB] p-3.5"
                >
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="flex flex-col gap-[6px]">
                      <span className="text-[12px] font-bold text-ink">Name</span>
                      <input
                        name="ec_name"
                        defaultValue={c.name}
                        placeholder="e.g. Sara Danyar"
                        className={input}
                      />
                    </label>
                    <label className="flex flex-col gap-[6px]">
                      <span className="text-[12px] font-bold text-ink">Relation</span>
                      <input name="ec_relation" defaultValue={c.relation} placeholder="Mother" className={input} />
                    </label>
                  </div>
                  <div className="flex items-end gap-2.5">
                    <label className="flex flex-1 flex-col gap-[6px]">
                      <span className="text-[12px] font-bold text-ink">Phone</span>
                      <input name="ec_phone" defaultValue={c.phone} placeholder="416-555-…" className={input} />
                    </label>
                    {contacts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setContacts((rows) => rows.filter((_, j) => j !== i))}
                        className="mb-1 text-[11.5px] font-bold text-faint hover:text-danger"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setContacts((rows) => [...rows, { name: "", relation: "", phone: "" }])
                }
                className="self-start rounded-btn border-[1.5px] border-dashed border-[#D6E1F0] px-3.5 py-2 text-[12.5px] font-bold text-primary hover:bg-canvas"
              >
                + Add another contact
              </button>
            </div>
          </form>

          {/* ── Medications tab (read-only) ────────────────────────────── */}
          {tab === "Medications" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className={sectionLabel}>MEDICATION AUTHORIZATIONS</span>
                <span className="flex-1" />
                <button
                  type="button"
                  disabled
                  title="Parents authorize medications from their app — they appear here"
                  className="cursor-default text-[12.5px] font-bold text-faint"
                >
                  + Authorize medication
                </button>
              </div>
              {medications.length === 0 ? (
                <p className="text-[12.5px] text-faint">None on file.</p>
              ) : (
                medications.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-[#EDF3FB] p-3.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold text-ink">
                        {m.name} <span className="font-semibold text-muted">{m.dosage}</span>
                      </span>
                      <span className="block text-[11.5px] text-muted">
                        {m.schedule ?? "—"}
                        {m.active && m.parent ? ` · authorized by ${m.parent.full_name}` : ""}
                        {!m.active ? " · awaiting parent consent" : ""}
                      </span>
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-[3px] text-[11px] font-bold ${
                        m.active ? "bg-[#E4F3EC] text-success" : "bg-warning-bg text-warning-text"
                      }`}
                    >
                      {m.active ? "Active" : "Consent needed"}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Family & pickups tab (non-record: parents + pickups) ────── */}
          {tab === "Family & pickups" && (
            <div className="mt-5 flex flex-col gap-5 border-t border-[#EDF3FB] pt-5">
              <LinkedParents childId={child.id} guardians={guardians} pendingInvites={pendingInvites} />
              <AuthorizedPickups childId={child.id} pickups={pickups} childName={child.first_name} />
            </div>
          )}

          {/* ── Consents tab ───────────────────────────────────────────── */}
          {tab === "Consents" && (
            <div className="flex flex-col gap-3">
              <span className={sectionLabel}>CONSENTS &amp; DOCUMENTS</span>
              {CONSENT_KINDS.map((kind) => {
                const granted = consents.find((c) => c.kind === kind)?.granted ?? false;
                return (
                  <form
                    key={kind}
                    action={setConsentAction}
                    className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-[#EDF3FB] px-3.5 py-3"
                  >
                    <input type="hidden" name="child_id" value={child.id} />
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="granted" value={(!granted).toString()} />
                    <span className="flex-1 text-[13px] font-semibold text-ink">{kind}</span>
                    <button
                      type="submit"
                      role="switch"
                      aria-checked={granted}
                      aria-label={`${granted ? "Revoke" : "Grant"} ${kind}`}
                      className={`relative h-[24px] w-[42px] flex-none rounded-full transition-colors ${
                        granted ? "bg-primary" : "bg-[#D6E1F0]"
                      }`}
                    >
                      <span
                        className={`absolute top-[3px] size-[18px] rounded-full bg-white transition-all ${
                          granted ? "right-[3px]" : "left-[3px]"
                        }`}
                      />
                    </button>
                  </form>
                );
              })}
              <div className="mt-1 flex flex-col gap-2">
                {["Immunization record", "Enrollment agreement"].map((doc) => (
                  <div
                    key={doc}
                    className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-[#EDF3FB] px-3.5 py-3"
                  >
                    <span className="flex-1 text-[13px] font-semibold text-ink">{doc}</span>
                    <button type="button" disabled className="text-[12px] font-bold text-faint">
                      Replace
                    </button>
                  </div>
                ))}
                <p className="text-[11px] text-faint">
                  Document uploads land here with the vault — next on the compliance roadmap.
                  Parents grant consents from their app; toggling here overrides for the record.
                </p>
              </div>
            </div>
          )}

          {(state.ok || state.error) && (
            <div className="mt-4">
              {state.ok && (
                <p className="rounded-[13px] border-[1.5px] border-[#BFE3D0] bg-[#E4F3EC] px-4 py-2.5 text-[12.5px] text-ink">
                  <b>Saved.</b>
                </p>
              )}
              {state.error && (
                <p className="rounded-[13px] border-[1.5px] border-[#EFC9C9] bg-danger-bg px-4 py-2.5 text-[12.5px] text-ink">
                  {state.error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2.5 border-t border-[#EDF3FB] px-6 py-4">
          <form action={archiveChildAction}>
            <input type="hidden" name="child_id" value={child.id} />
            <button
              type="submit"
              className="text-[13px] font-bold text-danger hover:underline"
            >
              Remove from center
            </button>
          </form>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-5 py-2.5 text-[13px] font-bold text-ink hover:bg-canvas"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={FORM_ID}
            disabled={pending}
            className="rounded-btn bg-primary px-5 py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LabeledInput({
  label: text,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-[7px]">
      <span className={label}>{text}</span>
      <input className={input} {...props} />
    </label>
  );
}

// ── Linked parents (19d) ──────────────────────────────────────────────────
function LinkedParents({
  childId,
  guardians,
  pendingInvites,
}: {
  childId: string;
  guardians: Guardian[];
  pendingInvites: PendingParentInvite[];
}) {
  const [inviteState, invite, inviting] = useActionState<ChildActionState, FormData>(
    inviteParentAction,
    {},
  );
  const [showInvite, setShowInvite] = useState(false);

  return (
    <div className="flex flex-col gap-2.5">
      <span className={sectionLabel}>LINKED PARENTS</span>
      {guardians
        .filter((g) => g.parent)
        .map((g) => (
          <div key={g.parent!.id} className="flex items-center gap-2.5">
            <Avatar name={g.parent!.full_name} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold text-ink">
                {g.parent!.full_name}
              </span>
              <span className="block truncate text-[11.5px] text-muted">
                {g.relationship ?? "Parent"} · {g.parent!.email}
              </span>
            </span>
            <span className="rounded-full bg-[#E4F3EC] px-2.5 py-[3px] text-[11px] font-bold text-success">
              Linked
            </span>
            <form action={unlinkParentAction}>
              <input type="hidden" name="child_id" value={childId} />
              <input type="hidden" name="parent_id" value={g.parent!.id} />
              <button type="submit" className="text-[11.5px] font-bold text-faint hover:text-danger">
                Unlink
              </button>
            </form>
          </div>
        ))}

      {pendingInvites.map((inv) => (
        <div key={inv.id} className="flex items-center gap-2.5">
          <span className="grid size-8 flex-none place-items-center rounded-full bg-canvas text-[11px] font-bold text-faint">
            ?
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold text-ink">
              {inv.email ?? "Invite"}
            </span>
            <span className="block text-[11.5px] text-muted">
              {inv.relationship ?? "Parent"} · code{" "}
              <span className="font-mono font-semibold">{inv.code}</span>
            </span>
          </span>
          <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[11px] font-bold text-warning-text">
            Pending
          </span>
        </div>
      ))}

      {showInvite ? (
        <form action={invite} className="flex flex-col gap-2 rounded-[14px] bg-canvas p-3.5">
          <input type="hidden" name="child_id" value={childId} />
          {inviteState.ok && inviteState.inviteCode ? (
            <p className="text-[12px] text-ink">
              <b>Invite created.</b> Code{" "}
              <span className="font-mono font-bold">{inviteState.inviteCode}</span> — the parent
              enters it in the app.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <input name="email" type="email" required placeholder="parent@email.com" className={input} />
                <input name="relationship" placeholder="Mother" className={input} />
              </div>
              {inviteState.error && (
                <p className="text-[11.5px] font-semibold text-danger">{inviteState.error}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowInvite(false)}
                  className="rounded-btn px-3 py-1.5 text-[12px] font-bold text-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="rounded-btn bg-primary px-3.5 py-1.5 text-[12px] font-bold text-white hover:bg-primary-hover"
                >
                  {inviting ? "Creating…" : "Create invite"}
                </button>
              </div>
            </>
          )}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowInvite(true)}
          className="self-start rounded-btn border-[1.5px] border-dashed border-[#D6E1F0] px-3.5 py-2 text-[12.5px] font-bold text-primary hover:bg-canvas"
        >
          + Invite or link a parent
        </button>
      )}
    </div>
  );
}

// ── Authorized pickups (19d) ──────────────────────────────────────────────
function AuthorizedPickups({
  childId,
  pickups,
  childName,
}: {
  childId: string;
  pickups: ChildPickup[];
  childName: string;
}) {
  const [addState, add, adding] = useActionState<ChildActionState, FormData>(addPickupAction, {});
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className={sectionLabel}>AUTHORIZED PICKUPS</span>
        <span className="flex-1" />
        {!showAdd && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
          >
            + Add pickup person
          </button>
        )}
      </div>

      {pickups.map((p) => (
        <div key={p.id} className="flex items-center gap-2.5">
          <Avatar name={p.full_name} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold text-ink">
              {p.full_name}
              {p.relationship ? <span className="font-semibold text-muted"> · {p.relationship}</span> : null}
            </span>
            <span className="block text-[11.5px] text-muted">
              PIN <span className="font-mono font-semibold text-ink">{p.pin}</span>
            </span>
          </span>
          <span
            className={`rounded-full px-2.5 py-[3px] text-[11px] font-bold ${
              p.is_primary ? "bg-[#E7F0FB] text-primary" : "bg-[#E4F3EC] text-success"
            }`}
          >
            {p.is_primary ? "Primary" : "Approved"}
          </span>
          <form action={removePickupAction}>
            <input type="hidden" name="child_id" value={childId} />
            <input type="hidden" name="pickup_id" value={p.id} />
            <button type="submit" className="text-[11.5px] font-bold text-faint hover:text-danger">
              Remove
            </button>
          </form>
        </div>
      ))}
      {pickups.length === 0 && (
        <p className="text-[12px] text-faint">No pickup people added yet.</p>
      )}

      {showAdd && (
        <form action={add} className="flex flex-col gap-2 rounded-[14px] bg-canvas p-3.5">
          <input type="hidden" name="child_id" value={childId} />
          {addState.ok && addState.pin ? (
            <p className="text-[12px] text-ink">
              <b>Added.</b> Share PIN{" "}
              <span className="font-mono text-[15px] font-bold tracking-[.15em]">{addState.pin}</span>{" "}
              with the family — educators verify it at the door.
            </p>
          ) : (
            <>
              <p className="text-[11.5px] text-muted">
                They can collect {childName} with the 4-digit PIN generated on add.
              </p>
              <input name="full_name" required placeholder="e.g. Rosa Torres" className={input} />
              <div className="grid grid-cols-2 gap-2">
                <input name="relationship" placeholder="Grandmother" className={input} />
                <input name="phone" placeholder="416-555-…" className={input} />
              </div>
              {addState.error && (
                <p className="text-[11.5px] font-semibold text-danger">{addState.error}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="rounded-btn px-3 py-1.5 text-[12px] font-bold text-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="rounded-btn bg-primary px-3.5 py-1.5 text-[12px] font-bold text-white hover:bg-primary-hover"
                >
                  {adding ? "Adding…" : "Add pickup"}
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
