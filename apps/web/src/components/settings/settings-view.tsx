"use client";

import type { Tables } from "@dailylog/db";
import type { Closure, NotificationPreferenceRow } from "@dailylog/db/queries";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import {
  addClosureAction,
  deleteClosureAction,
  saveLatePickupPolicyAction,
  setAdminMfaRequirementAction,
  updateCenterAction,
  updateParentDataRequestAction,
  type SettingsActionState,
} from "@/lib/settings/actions";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const cardTitle = "text-[14px] font-extrabold text-ink";

export interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  created_at: string | null;
  before: unknown;
  after: unknown;
  actor: { full_name: string } | null;
}

export interface ParentDataRequest {
  id: string;
  request_type: "export" | "deletion";
  status: "requested" | "processing";
  requested_at: string;
  updated_at: string;
  profile: { full_name: string; email: string } | null;
}

type LatePickupPolicy = Tables<"late_pickup_policies">;
type AuditCategory = "all" | "security" | "money" | "records";

const AUDIT_LABELS: Record<string, string> = {
  account_security: "account security",
  attendance_records: "attendance record",
  center_closures: "center closure",
  children: "child record",
  daycares: "center settings",
  family_ledger_entries: "family ledger",
  incident_reports: "incident report",
  invoices: "invoice",
  late_pickup_events: "late-pickup event",
  late_pickup_policies: "late-pickup policy",
  payments: "payment",
  profiles: "role / membership",
  report_exports: "report export",
  report_schedules: "report schedule",
  staff_delegations: "delegation",
};
const MONEY_ENTITIES = new Set(["invoices", "payments", "family_ledger_entries", "late_pickup_events"]);
const SECURITY_ENTITIES = new Set(["account_security", "profiles", "staff_delegations", "staff_invites", "roles", "role_permissions"]);
const SAFE_CHANGE_KEYS = new Set([
  "name", "address", "phone", "opens_at", "closes_at", "licensed_capacity",
  "license_number", "effective_from", "grace_minutes", "fee_per_minute_cents",
  "daily_cap_cents", "conversation_after_count", "reason", "starts_on", "ends_on",
  "billing_treatment", "status", "role", "access_level", "areas", "due_on",
  "total_cents", "amount_cents",
]);

export function SettingsView({
  daycare,
  closures,
  audit = [],
  dataRequests = [],
  latePickupPolicy,
  notificationPreferences = [],
  mfaEnabled,
}: {
  daycare: Tables<"daycares"> | null;
  closures: Closure[];
  audit?: AuditEntry[];
  dataRequests?: ParentDataRequest[];
  latePickupPolicy: LatePickupPolicy | null;
  notificationPreferences?: NotificationPreferenceRow[];
  mfaEnabled: boolean;
}) {
  const [modal, setModal] = useState<"none" | "center" | "closure" | "late-pickup">("none");
  const [auditCategory, setAuditCategory] = useState<AuditCategory>("all");
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
  const [auditLimit, setAuditLimit] = useState(12);
  const filteredAudit = useMemo(
    () => audit.filter((entry) => auditCategory === "all" || auditGroup(entry.entity_type) === auditCategory),
    [audit, auditCategory],
  );
  const visibleAudit = filteredAudit.slice(0, auditLimit);
  const fmt = (date: string) => new Date(`${date}T12:00`).toLocaleDateString("en-CA", {
    month: "short", day: "numeric", year: "numeric",
  });
  const lateSummary = latePickupPolicy
    ? `${money(latePickupPolicy.fee_per_minute_cents)} per minute after ${latePickupPolicy.grace_minutes} min · ${money(latePickupPolicy.daily_cap_cents)} daily cap`
    : "Default: $1 per minute after 5 min · $40 daily cap";

  return (
    <div className="flex flex-1 flex-col gap-5 p-7">
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className={card}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className={cardTitle}>Center profile</h2><span className="flex-1" />
              <button type="button" onClick={() => setModal("center")} className="text-[12.5px] font-bold text-primary hover:text-primary-hover">Edit</button>
            </div>
            <dl className="grid gap-x-7 gap-y-2 md:grid-cols-2">
              <Row label="Name">{daycare?.name ?? "—"}</Row><Row label="Phone">{daycare?.phone ?? "—"}</Row>
              <Row label="Address">{daycare?.address ?? "—"}</Row><Row label="Hours">{daycare ? `${shortTime(daycare.opens_at)} – ${shortTime(daycare.closes_at)}` : "—"}</Row>
              <Row label="Licensed capacity">{daycare ? `${daycare.licensed_capacity} children` : "—"}</Row><Row label="License no.">{daycare?.license_number || "Not entered"}</Row>
            </dl>
            <p className="mt-3 text-[11.5px] text-faint">These facts print on invoices, tax forms, attendance records and exports.</p>
          </section>

          <section className={card}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className={cardTitle}>Policies</h2><span className="flex-1" />
              <button type="button" onClick={() => setModal("late-pickup")} className="text-[12.5px] font-bold text-primary hover:text-primary-hover">Edit late-pickup policy</button>
            </div>
            <PolicyRow title="Late pickup fee" description={lateSummary} status="Active" editable />
            <PolicyRow title="Sick return rule" description={`${daycare?.sick_return_hours ?? 24} h fever-free before returning`} status="Active" />
            <PolicyRow title="Photo consent required" description="Children without consent are blocked from shared photos" status="Required" />
            <PolicyRow title="ID check for new pickup people" description="Pickup PIN and approved-person checks stay enforced" status="Required" />
          </section>

          <section className={card}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className={cardTitle}>Closures & holidays</h2><span className="flex-1" />
              <button type="button" onClick={() => setModal("closure")} className="rounded-btn bg-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-primary-hover">+ Add closure</button>
            </div>
            {closures.length === 0 ? <p className="text-[12.5px] text-faint">No closures planned.</p> : (
              <div className="flex flex-col">{closures.map((closure) => (
                <div key={closure.id} className="flex items-center gap-3 border-b border-[#EDF3FB] py-2.5 last:border-b-0">
                  <span className="rounded-lg bg-warning-bg px-2.5 py-1.5 text-[10.5px] font-bold text-warning-text">{fmt(closure.starts_on)}</span>
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-bold text-ink">{closure.reason}</span><span className="block text-[11.5px] text-muted">{closure.starts_on === closure.ends_on ? "Single day" : `Through ${fmt(closure.ends_on)}`} · no charge · families notified</span></span>
                  <form action={deleteClosureAction} onSubmit={(event) => { if (!window.confirm(`Cancel ${closure.reason}? Families will be notified immediately.`)) event.preventDefault(); }}>
                    <input type="hidden" name="closure_id" value={closure.id} /><button type="submit" className="text-[11.5px] font-bold text-danger hover:underline">Cancel closure</button>
                  </form>
                </div>
              ))}</div>
            )}
            <p className="mt-3 text-[11.5px] leading-relaxed text-faint">Closure days block attendance check-in, late fees and new tour bookings. Cancelling sends a family notice.</p>
          </section>

          <section className={card}>
            <h2 className={`${cardTitle} mb-2`}>Ratio rules</h2>
            <p className="text-[12.5px] leading-relaxed text-muted">Children-per-educator minimums live with rooms. <Link href="/rooms" className="font-bold text-primary">Edit ratio rules →</Link></p>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <section className={card}>
            <h2 className={`${cardTitle} mb-3`}>Security & delegation</h2>
            <Row label="Your two-step verification"><StatusPill on={mfaEnabled}>{mfaEnabled ? "On" : "Not set up"}</StatusPill></Row>
            <SecurityRequirementControl
              enabled={daycare?.require_admin_mfa ?? false}
              mfaEnabled={mfaEnabled}
            />
            <Row label="Default delegation">{daycare?.default_delegation_days ?? 14} days</Row>
            <Row label="Delegations need expiry"><span className="font-bold text-success">Always</span></Row><Row label="Audit retention">7 years</Row>
            {!mfaEnabled && <p className="mt-3 rounded-xl bg-warning-bg px-3 py-2 text-[11.5px] leading-relaxed text-warning-text">Protect your account first, then you can require two-step verification for every administrator.</p>}
            <Link href={mfaEnabled ? "/two-step?mode=manage" : "/two-step?mode=setup&next=/settings"} className="mt-3 block text-[12px] font-bold text-primary">{mfaEnabled ? "Manage your authenticators" : "Set up two-step verification"} →</Link>
            <Link href="/staff?tab=delegations" className="mt-3 block text-[12px] font-bold text-primary">Manage delegations →</Link>
          </section>

          <section className={card}>
            <h2 className={`${cardTitle} mb-3`}>Your notifications</h2>
            <NotificationRow label="Ratio alerts" enabled={preferenceOn(notificationPreferences, "ratio_alert", "push", true)} detail="push, instantly" />
            <NotificationRow label="Incident reports" enabled={preferenceOn(notificationPreferences, "incident_report", "push", false)} detail="push" />
            <NotificationRow label="Overdue invoices" enabled={preferenceOn(notificationPreferences, "overdue_billing", "email", false)} detail="email digest" />
            <p className="mt-3 text-[11.5px] leading-relaxed text-faint">Use the notification bell to choose delivery channels and quiet hours.</p>
          </section>

          <section className={card}>
            <div className="mb-2 flex items-center gap-2"><h2 className={cardTitle}>Privacy & data requests</h2>{dataRequests.length > 0 && <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[10.5px] font-bold text-warning-text">{dataRequests.length} open</span>}</div>
            {dataRequests.length === 0 ? <p className="text-[12px] text-faint">No parent requests need review.</p> : dataRequests.map((request) => (
              <div key={request.id} className="border-b border-[#EDF3FB] py-2.5 last:border-b-0">
                <span className="block truncate text-[12.5px] font-bold text-ink">{request.profile?.full_name ?? "Parent account"}</span><span className="block text-[11px] text-muted">{request.request_type === "export" ? "Family data export" : "Account deletion review"}</span>
                <form action={updateParentDataRequestAction} className="mt-2"><input type="hidden" name="request_id" value={request.id} /><input type="hidden" name="status" value={request.status === "requested" ? "processing" : "completed"} /><button type="submit" className="text-[11.5px] font-bold text-primary">{request.status === "requested" ? "Start review" : "Mark handled"} →</button></form>
              </div>
            ))}
          </section>
        </aside>
      </div>

      <section className={`${card} overflow-hidden p-0`}>
        <div className="flex flex-wrap items-center gap-2 px-5 py-4"><h2 className="mr-auto text-[16px] font-extrabold text-ink">Audit log</h2>{(["all", "security", "money", "records"] as const).map((category) => <button key={category} type="button" onClick={() => { setAuditCategory(category); setAuditLimit(12); setExpandedAudit(null); }} className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold capitalize ${auditCategory === category ? "bg-primary text-white" : "border border-[#D6E1F0] bg-white text-body"}`}>{category}</button>)}</div>
        {visibleAudit.length === 0 ? <p className="border-t border-[#EDF3FB] px-5 py-6 text-[12.5px] text-faint">No matching changes yet.</p> : visibleAudit.map((entry) => {
          const changes = auditChanges(entry);
          return <button key={entry.id} type="button" onClick={() => setExpandedAudit((value) => value === entry.id ? null : entry.id)} className="block w-full border-t border-[#EDF3FB] px-5 py-3 text-left hover:bg-[#F8FBFE]">
            <span className="flex items-start gap-3"><span className="w-[108px] flex-none text-[10.5px] font-bold text-faint">{entry.created_at ? new Date(entry.created_at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</span><span className="min-w-0 flex-1 text-[12.5px] text-ink"><b>{entry.actor?.full_name ?? "System"}</b> {auditVerb(entry.action)} {AUDIT_LABELS[entry.entity_type] ?? humanize(entry.entity_type)}</span><span className="text-[11px] font-bold text-faint">{expandedAudit === entry.id ? "Hide" : "Details"}</span></span>
            {expandedAudit === entry.id && <span className="mt-2 block rounded-xl bg-canvas px-3 py-2 text-[11.5px] leading-relaxed text-muted">{changes || "The event is retained with its original timestamp and actor."}</span>}
          </button>;
        })}
        {filteredAudit.length > visibleAudit.length && <button type="button" onClick={() => setAuditLimit((value) => value + 12)} className="block w-full border-t border-[#EDF3FB] py-3 text-center text-[12px] font-bold text-primary hover:bg-[#F8FBFE]">Show 12 more changes</button>}
        <div className="flex items-center gap-3 border-t border-[#E4ECF6] bg-[#F8FBFE] px-5 py-3"><span className="text-[11.5px] text-faint">Kept 7 years · cannot be edited or deleted</span><span className="flex-1" /><a href="/settings/audit-export" className="text-[12px] font-bold text-primary">Export for an inspection →</a></div>
      </section>

      {modal === "center" && daycare && <CenterModal daycare={daycare} onClose={() => setModal("none")} />}
      {modal === "closure" && <ClosureModal onClose={() => setModal("none")} />}
      {modal === "late-pickup" && daycare && <LatePickupPolicyModal daycare={daycare} policy={latePickupPolicy} onClose={() => setModal("none")} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) { return <div className="flex justify-between gap-3 py-0.5"><dt className="text-[12.5px] text-muted">{label}</dt><dd className="text-right text-[12.5px] font-semibold text-ink">{children}</dd></div>; }
function StatusPill({ on, children }: { on: boolean; children: React.ReactNode }) { return <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${on ? "bg-[#E4F3EC] text-success" : "bg-warning-bg text-warning-text"}`}>{children}</span>; }
function PolicyRow({ title, description, status, editable = false }: { title: string; description: string; status: string; editable?: boolean }) { return <div className="flex items-center gap-3 border-t border-[#EDF3FB] py-2.5 first:border-t-0"><span className="min-w-0 flex-1"><span className="block text-[13px] font-bold text-ink">{title}</span><span className="block text-[11.5px] text-muted">{description}</span></span><span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${editable ? "bg-[#E3EDFA] text-primary" : "bg-[#E4F3EC] text-success"}`}>{status}</span></div>; }
function NotificationRow({ label, enabled, detail }: { label: string; enabled: boolean; detail: string }) { return <div className="flex items-center gap-2 border-t border-[#EDF3FB] py-2.5 first:border-t-0"><span className="min-w-0 flex-1"><span className="block text-[12.5px] font-semibold text-ink">{label}</span><span className="block text-[10.5px] text-faint">{detail}</span></span><span className={`h-[22px] w-[38px] rounded-full p-0.5 ${enabled ? "bg-primary" : "bg-[#D6E1F0]"}`}><span className={`block size-[18px] rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : ""}`} /></span></div>; }

function SecurityRequirementControl({ enabled, mfaEnabled }: { enabled: boolean; mfaEnabled: boolean }) {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(setAdminMfaRequirementAction, {});
  return <div className="border-t border-[#EDF3FB] py-2.5">
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12.5px] text-muted">Require for all admins</span>
      <form action={action}>
        <input type="hidden" name="required" value={enabled ? "false" : "true"} />
        <button type="submit" disabled={pending || (!enabled && !mfaEnabled)} aria-label={`${enabled ? "Disable" : "Enable"} required two-step verification`} className={`h-[22px] w-[38px] rounded-full p-0.5 disabled:cursor-not-allowed disabled:opacity-40 ${enabled ? "bg-primary" : "bg-[#D6E1F0]"}`}>
          <span className={`block size-[18px] rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : ""}`} />
        </button>
      </form>
    </div>
    {state.ok && <p className="mt-1.5 text-[10.5px] font-bold text-success">Security rule updated.</p>}
    {state.error && <p className="mt-1.5 text-[10.5px] leading-normal text-danger">{state.error}</p>}
  </div>;
}

function CenterModal({ daycare, onClose }: { daycare: Tables<"daycares">; onClose: () => void }) {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(updateCenterAction, {});
  return <Modal onClose={onClose} width={470}><div><h2 className="text-[19px] font-extrabold text-ink">Center profile</h2><p className="mt-0.5 text-[12.5px] text-muted">These details print on invoices, tax forms and attendance records.</p></div><form action={action} className="flex flex-col gap-4">
    <div className="grid grid-cols-2 gap-2.5"><Field label="Name" name="name" defaultValue={daycare.name} required /><Field label="Phone" name="phone" defaultValue={daycare.phone ?? ""} /></div><Field label="Address" name="address" defaultValue={daycare.address ?? ""} />
    <div className="grid grid-cols-2 gap-2.5"><Field label="Opens" name="opens_at" type="time" defaultValue={daycare.opens_at.slice(0, 5)} required /><Field label="Closes" name="closes_at" type="time" defaultValue={daycare.closes_at.slice(0, 5)} required /></div>
    <div className="grid grid-cols-2 gap-2.5"><Field label="Licensed capacity" name="licensed_capacity" type="number" min={0} max={10000} defaultValue={daycare.licensed_capacity} required /><Field label="License no." name="license_number" defaultValue={daycare.license_number ?? ""} /></div>
    <div className="rounded-[13px] border border-[#EFD9B5] bg-warning-bg px-3.5 py-3 text-[11.5px] leading-relaxed text-warning-text">Closing time drives the late-pickup clock. Capacity cannot be lowered below active child records.</div>{state.ok && <Notice tone="success"><b>Saved.</b> The change is in the audit log.</Notice>}{state.error && <Notice tone="error">{state.error}</Notice>}
    <div className="flex gap-2.5"><Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>{state.ok ? "Close" : "Cancel"}</Button><Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button></div>
  </form></Modal>;
}

function ClosureModal({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(addClosureAction, {});
  return <Modal onClose={onClose} width={430}><div><h2 className="text-[19px] font-extrabold text-ink">Add a closure</h2><p className="mt-0.5 text-[12.5px] text-muted">The center is closed — the calendar, families and operations adjust together.</p></div><form action={action} className="flex flex-col gap-4">
    <div className="grid grid-cols-2 gap-2.5"><Field label="Date" name="starts_on" type="date" required /><Field label="Through (optional)" name="ends_on" type="date" /></div><Field label="Reason" name="reason" placeholder="Staff training" required /><Field label="Message to families (optional)" name="family_message" placeholder="The whole center is closed for staff training." /><Field label="Remind families days before" name="reminder_days_before" type="number" min={0} max={30} defaultValue={3} required />
    <div className="rounded-[13px] bg-[#E4F3EC] px-3.5 py-3 text-[12px] leading-relaxed text-[#1B6B45]"><b>No-charge day.</b> Families are notified now, reminded before the closure, and see it in their calendar.</div>{state.ok && <Notice tone="success"><b>Closure added and notices queued.</b></Notice>}{state.error && <Notice tone="error">{state.error}</Notice>}
    <div className="flex gap-2.5"><Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>{state.ok ? "Close" : "Cancel"}</Button><Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>{pending ? "Adding…" : "Add closure"}</Button></div>
  </form></Modal>;
}

function LatePickupPolicyModal({ daycare, policy, onClose }: { daycare: Tables<"daycares">; policy: LatePickupPolicy | null; onClose: () => void }) {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(saveLatePickupPolicyAction, {});
  const fee = (policy?.fee_per_minute_cents ?? 100) / 100; const cap = (policy?.daily_cap_cents ?? 4000) / 100; const grace = policy?.grace_minutes ?? 5; const count = policy?.conversation_after_count ?? 3;
  return <Modal onClose={onClose} width={470}><div><h2 className="text-[19px] font-extrabold text-ink">Late-pickup policy</h2><p className="mt-0.5 text-[12.5px] text-muted">The clock starts at closing time — {shortTime(daycare.closes_at)}.</p></div><form action={action} className="flex flex-col gap-4">
    <div className="grid grid-cols-3 gap-2.5"><Field label="Fee / minute" name="fee_per_minute" inputMode="decimal" defaultValue={fee.toFixed(2)} required /><Field label="Grace minutes" name="grace_minutes" type="number" min={0} max={120} defaultValue={grace} required /><Field label="Daily cap" name="daily_cap" inputMode="decimal" defaultValue={cap.toFixed(2)} required /></div><Field label="Conversation instead of fee on pickup number" name="conversation_after_count" type="number" min={1} max={20} defaultValue={count} required />
    <div className="rounded-[13px] bg-canvas px-3.5 py-3 text-[12px] leading-relaxed text-ink"><span className="mb-1 block font-mono text-[10px] font-bold tracking-[.08em] text-faint">WHAT FAMILIES SEE</span>“Pickup is by {shortTime(daycare.closes_at)}. After a {grace}-minute grace period, a fee of {money(Math.round(fee * 100))} per minute (max {money(Math.round(cap * 100))}/day) is added to your account.”</div>{state.ok && <Notice tone="success"><b>Policy scheduled.</b> It applies from tomorrow; today’s pickups keep today’s rules.</Notice>}{state.error && <Notice tone="error">{state.error}</Notice>}
    <div className="flex gap-2.5"><Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>{state.ok ? "Close" : "Cancel"}</Button><Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>{pending ? "Saving…" : "Save policy"}</Button></div>
  </form></Modal>;
}

function preferenceOn(preferences: NotificationPreferenceRow[], kind: string, channel: "push" | "email", fallback: boolean): boolean { const preference = preferences.find((item) => item.kind === kind); return preference ? preference[channel] : fallback; }
function auditGroup(entity: string): Exclude<AuditCategory, "all"> { if (MONEY_ENTITIES.has(entity)) return "money"; if (SECURITY_ENTITIES.has(entity)) return "security"; return "records"; }
function auditVerb(action: string): string { if (action === "insert") return "created"; if (action === "delete") return "cancelled / removed"; if (action.includes("export")) return "exported"; return "changed"; }
function auditChanges(entry: AuditEntry): string { const before = isRecord(entry.before) ? entry.before : {}; const after = isRecord(entry.after) ? entry.after : {}; const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => SAFE_CHANGE_KEYS.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])); return keys.slice(0, 5).map((key) => `${humanize(key)}: ${displayAuditValue(before[key])} → ${displayAuditValue(after[key])}`).join(" · "); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function displayAuditValue(value: unknown): string { if (value == null || value === "") return "—"; if (Array.isArray(value)) return value.join(", "); if (typeof value === "boolean") return value ? "on" : "off"; if (typeof value === "number") return String(value); if (typeof value === "string") return value.length > 45 ? `${value.slice(0, 42)}…` : value; return "updated"; }
function humanize(value: string): string { return value.replaceAll("_", " "); }
function money(cents: number): string { return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" }); }
function shortTime(value: string): string { const [hourValue, minute] = value.slice(0, 5).split(":").map(Number); const suffix = hourValue >= 12 ? "PM" : "AM"; return `${hourValue % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`; }
