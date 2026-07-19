"use client";

import type { ChildDocument, ChildPickup, PendingParentInvite, Tables } from "@dailylog/db";
import { CONSENT_KINDS, type EmergencyContact } from "@dailylog/shared";
import { useActionState, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import {
  addPickupAction,
  archiveChildAction,
  inviteParentAction,
  removePickupAction,
  resendParentInviteAction,
  saveMedicationAction,
  setConsentAction,
  unlinkParentAction,
  uploadChildDocumentAction,
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
  parent_id: string | null;
  name: string;
  dosage: string;
  schedule: string | null;
  notes: string | null;
  active: boolean;
  parent: { full_name: string } | null;
};

type Consent = { id: string; kind: string; granted: boolean };

const TABS = ["Details", "Medical", "Medications", "Family & pickups", "Consents"] as const;
type Tab = (typeof TABS)[number];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
type Weekday = (typeof WEEKDAYS)[number];
type ScheduleValue = "full" | "half" | "off";

function readSchedule(value: unknown): Record<Weekday, ScheduleValue> {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return Object.fromEntries(
    WEEKDAYS.map((day) => [day, source[day] === "full" || source[day] === "half" ? source[day] : "off"]),
  ) as Record<Weekday, ScheduleValue>;
}

function nextSchedule(value: ScheduleValue): ScheduleValue {
  return value === "full" ? "half" : value === "half" ? "off" : "full";
}

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
  documents,
  guardians,
  pendingInvites,
  photoUrl,
  initialTab,
  onClose,
}: {
  child: Tables<"children">;
  classrooms: { id: string; name: string }[];
  pickups: ChildPickup[];
  medications: Medication[];
  consents: Consent[];
  documents: ChildDocument[];
  guardians: Guardian[];
  pendingInvites: PendingParentInvite[];
  photoUrl: string | null;
  initialTab: Tab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [room, setRoom] = useState(child.classroom_id ?? "");
  const [removePhoto, setRemovePhoto] = useState(false);
  const [schedule, setSchedule] = useState<Record<Weekday, ScheduleValue>>(
    readSchedule(
      child.setup_state && typeof child.setup_state === "object" && !Array.isArray(child.setup_state)
        ? (child.setup_state as Record<string, unknown>).weekly_schedule
        : null,
    ),
  );
  const [editingMedication, setEditingMedication] = useState<Medication | "new" | null>(null);
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
        <div className="flex items-center gap-5 border-b border-[#EDF3FB] px-6" role="tablist" aria-label="Edit child sections">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
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
            <input type="hidden" name="existing_photo_url" value={child.photo_url ?? ""} />
            <input type="hidden" name="remove_photo" value={removePhoto.toString()} />
            {WEEKDAYS.map((day) => (
              <input key={day} type="hidden" name={`schedule_${day}`} value={schedule[day]} />
            ))}

            {/* DETAILS */}
            <div className={`flex flex-col gap-4 ${shown("Details")}`}>
              <div className="flex items-center gap-3.5">
                <Avatar name={name} src={removePhoto ? null : photoUrl} size={64} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-ink">Profile photo</span>
                  <span className="block text-[11.5px] leading-normal text-muted">
                    Shown to educators at check-in and pickup. Square image, at least 240px.
                  </span>
                  <span className="mt-1.5 flex items-center gap-3">
                    <label className="cursor-pointer rounded-btn bg-tint px-3 py-1.5 text-[12px] font-bold text-primary hover:bg-[#D9E8FA]">
                      Upload photo
                      <input
                        type="file"
                        name="photo"
                        accept="image/*"
                        className="sr-only"
                        onChange={() => setRemovePhoto(false)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setRemovePhoto(true)}
                      className="text-[12px] font-semibold text-faint hover:text-danger"
                    >
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
                <div className="grid grid-cols-5 gap-2">
                  {WEEKDAYS.map((day) => {
                    const value = schedule[day];
                    return (
                      <span key={day} className="text-center">
                        <span className="mb-1 block text-[9.5px] font-bold tracking-[.06em] text-faint">
                          {day.toUpperCase()}
                        </span>
                        <button
                          type="button"
                          aria-label={`${day} schedule: ${value}. Click to change.`}
                          onClick={() => setSchedule((current) => ({ ...current, [day]: nextSchedule(current[day]) }))}
                          className={`w-full rounded-lg py-2 text-[11px] font-bold capitalize ${
                            value === "off"
                              ? "border-[1.5px] border-[#D6E1F0] bg-card text-faint"
                              : value === "half"
                                ? "bg-[#E7F0FB] text-primary"
                                : "bg-primary text-white"
                          }`}
                        >
                          {value}
                        </button>
                      </span>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-faint">
                  Select a day to cycle Full · Half · Off. The schedule drives attendance expectations and billing.
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
                  onClick={() => setEditingMedication("new")}
                  className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
                >
                  + Authorize medication
                </button>
              </div>
              {editingMedication && (
                <MedicationEditor
                  childId={child.id}
                  medication={editingMedication === "new" ? null : editingMedication}
                  guardians={guardians}
                  onCancel={() => setEditingMedication(null)}
                />
              )}
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
                    <button
                      type="button"
                      onClick={() => setEditingMedication(m)}
                      className="text-[12px] font-bold text-primary hover:underline"
                    >
                      Edit
                    </button>
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
                <DocumentUploadRow
                  childId={child.id}
                  title="Immunization record"
                  category="immunization_record"
                  document={documents.find((document) => document.category === "immunization_record")}
                />
                <DocumentUploadRow
                  childId={child.id}
                  title="Enrollment agreement"
                  category="enrollment_agreement"
                  document={documents.find((document) => document.category === "enrollment_agreement")}
                />
                <p className="text-[11px] text-faint">
                  PDF and image uploads are stored in the center&apos;s private document vault.
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

function MedicationEditor({
  childId,
  medication,
  guardians,
  onCancel,
}: {
  childId: string;
  medication: Medication | null;
  guardians: Guardian[];
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState<ChildActionState, FormData>(
    saveMedicationAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-3 rounded-[14px] border-[1.5px] border-[#D6E1F0] bg-canvas p-4">
      <input type="hidden" name="child_id" value={childId} />
      <input type="hidden" name="medication_id" value={medication?.id ?? ""} />
      <div className="grid grid-cols-2 gap-2.5">
        <input name="name" required defaultValue={medication?.name ?? ""} placeholder="Medication name" className={input} />
        <input name="dosage" required defaultValue={medication?.dosage ?? ""} placeholder="Dosage" className={input} />
        <input name="schedule" defaultValue={medication?.schedule ?? ""} placeholder="Schedule" className={input} />
        <select name="status" defaultValue={medication?.active === false ? "consent" : "active"} className={input}>
          <option value="active">Active</option>
          <option value="consent">Consent needed</option>
        </select>
        <select name="parent_id" defaultValue={medication?.parent_id ?? ""} className={`${input} col-span-2`}>
          <option value="">No parent authorization yet</option>
          {guardians.filter((guardian) => guardian.parent).map((guardian) => (
            <option key={guardian.parent!.id} value={guardian.parent!.id}>
              Authorized by {guardian.parent!.full_name}
            </option>
          ))}
        </select>
        <textarea
          name="notes"
          defaultValue={medication?.notes ?? ""}
          placeholder="Administration notes"
          rows={2}
          className={`${input} col-span-2`}
        />
      </div>
      {state.error && <p className="text-[11.5px] font-semibold text-danger">{state.error}</p>}
      {state.ok && <p className="text-[11.5px] font-semibold text-success">Medication saved.</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-btn px-3.5 py-2 text-[12px] font-bold text-muted">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="rounded-btn bg-primary px-4 py-2 text-[12px] font-bold text-white hover:bg-primary-hover disabled:opacity-60">
          {pending ? "Saving…" : "Save medication"}
        </button>
      </div>
    </form>
  );
}

function DocumentUploadRow({
  childId,
  title,
  category,
  document,
}: {
  childId: string;
  title: string;
  category: string;
  document?: ChildDocument;
}) {
  const [state, action, pending] = useActionState<ChildActionState, FormData>(
    uploadChildDocumentAction,
    {},
  );
  return (
    <form action={action} className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-[#EDF3FB] px-3.5 py-3">
      <input type="hidden" name="child_id" value={childId} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="category" value={category} />
      <span aria-hidden className="text-faint">▧</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink">{title}</span>
        {state.error && <span className="block text-[10.5px] font-semibold text-danger">{state.error}</span>}
        {state.ok && <span className="block text-[10.5px] font-semibold text-success">Uploaded</span>}
      </span>
      {document && (
        <a href={`/documents/${document.id}`} target="_blank" className="text-[12px] font-bold text-primary hover:underline">
          View
        </a>
      )}
      <label className="cursor-pointer text-[12px] font-bold text-primary hover:underline">
        {pending ? "Uploading…" : document ? "Replace" : "Upload"}
        <input
          type="file"
          name="file"
          accept="application/pdf,image/*"
          disabled={pending}
          className="sr-only"
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        />
      </label>
    </form>
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
              {inv.relationship ?? "Parent"} · invite sent
            </span>
          </span>
          <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[11px] font-bold text-warning-text">
            Pending
          </span>
          <form action={resendParentInviteAction}>
            <input type="hidden" name="child_id" value={childId} />
            <input type="hidden" name="invite_id" value={inv.id} />
            <button type="submit" className="text-[11.5px] font-bold text-primary hover:underline">
              Resend
            </button>
          </form>
        </div>
      ))}

      {showInvite ? (
        <form action={invite} className="flex flex-col gap-2 rounded-[14px] bg-canvas p-3.5">
          <input type="hidden" name="child_id" value={childId} />
          {inviteState.ok && inviteState.inviteCode ? (
            <p className="text-[12px] text-ink">
              <b>{inviteState.emailQueued ? "Invite emailed." : "Invite created."}</b> Code{" "}
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
