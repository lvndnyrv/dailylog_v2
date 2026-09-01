import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types.gen";

type Client = SupabaseClient<Database>;
export interface ComplianceDocument {
  id: string;
  title: string;
  category: string;
  expires_on: string | null;
  version: number;
  created_at: string;
  replaces_id: string | null;
  watch_expiry: boolean;
  include_in_inspection: boolean;
  size_bytes: number;
}
export interface ComplianceDrill {
  id: string;
  kind: string;
  conducted_at: string;
  lead_name: string;
  duration_seconds: number;
  children_count: number;
  staff_count: number;
  attendance_children: number;
  attendance_staff: number;
  notes: string;
  next_due_on: string | null;
  voided_at: string | null;
  void_reason: string | null;
}
export interface ComplianceStaffFile {
  id: string;
  name: string;
  status: string;
  credentials: {
    id: string;
    name: string;
    required: boolean;
    completed_on: string | null;
    expires_on: string | null;
    document_id: string | null;
    pending_review: boolean;
  }[];
}
export interface ComplianceInspectionPack {
  center_name: string;
  timezone: string;
  today: string;
  generated_at: string;
  documents: Pick<
    ComplianceDocument,
    "id" | "title" | "category" | "expires_on" | "version" | "created_at"
  >[];
  drills: ComplianceDrill[];
  staff: ComplianceStaffFile[];
  menu_days: number;
  attendance: {
    id: string;
    child_name: string;
    room: string | null;
    checked_in_at: string | null;
    checked_out_at: string | null;
    status: string;
    dropped_off_by: string | null;
    picked_up_by: string | null;
  }[];
  ratio_events: {
    id: string;
    room: string;
    started_at: string;
    resolved_at: string | null;
    peak_present: number;
    minimum_staff: number;
    required_staff: number;
  }[];
  ratio_ledger: {
    captured_since: string | null;
    opens_at: string;
    closes_at: string;
    observed_minutes: number;
    compliant_minutes: number;
    over_minutes: number;
    intervals: {
      id: string;
      room: string;
      starts_at: string;
      ends_at: string | null;
      present_count: number;
      staff_count: number;
      required_staff: number;
      max_children_per_staff: number;
      source:
        | "attendance"
        | "staff_time"
        | "coverage"
        | "room_rule"
        | "scheduled_sweep"
        | "legacy_event";
    }[];
  };
  incidents: {
    id: string;
    child_name: string;
    occurred_at: string;
    severity: string;
    status: string;
    signed_off_at: string | null;
    parent_acknowledged_at: string | null;
  }[];
  share_label?: string;
  share_expires_at?: string;
}
export interface ComplianceShare {
  id: string;
  label: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_opened_at: string | null;
}
export interface ComplianceDueItem {
  id: string;
  title: string;
  due_on: string;
  kind: string;
  days_left: number;
}
export async function listComplianceDueItems(
  client: Client,
): Promise<ComplianceDueItem[]> {
  const { data, error } = await client.rpc("list_compliance_due_items");
  if (error) throw error;
  return data ?? [];
}

export async function getComplianceInspectionPack(
  client: Client,
): Promise<ComplianceInspectionPack> {
  const { data, error } = await client.rpc("get_compliance_inspection_pack");
  if (error) throw error;
  return data as unknown as ComplianceInspectionPack;
}
export async function listComplianceDocuments(
  client: Client,
): Promise<ComplianceDocument[]> {
  const { data, error } = await client
    .from("compliance_documents")
    .select(
      "id,title,category,expires_on,version,created_at,replaces_id,watch_expiry,include_in_inspection,size_bytes",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
export async function listComplianceShares(
  client: Client,
): Promise<ComplianceShare[]> {
  const { data, error } = await client.rpc("list_compliance_inspection_shares");
  if (error) throw error;
  return data ?? [];
}
export function currentComplianceDocuments(documents: ComplianceDocument[]) {
  const replaced = new Set(documents.map((d) => d.replaces_id).filter(Boolean));
  return documents.filter((d) => !replaced.has(d.id));
}
export function staffFileGaps(
  staff: ComplianceStaffFile,
  today: string,
): string[] {
  const required = staff.credentials.filter((c) => c.required);
  if (!required.length) return ["Required checklist not configured"];
  return required.flatMap((c) => {
    if (c.pending_review) return [`${c.name}: renewal awaiting review`];
    if (!c.completed_on) return [`${c.name}: missing completion date`];
    if (c.expires_on && c.expires_on < today) return [`${c.name}: expired`];
    if (!c.document_id) return [`${c.name}: original not uploaded`];
    return [];
  });
}
export function complianceReadiness(pack: ComplianceInspectionPack) {
  const unsigned = pack.incidents.filter((i) => !i.signed_off_at).length;
  const completeStaff = pack.staff.filter(
    (s) => !staffFileGaps(s, pack.today).length,
  ).length;
  const checks = [
    {
      label: "Staff files complete",
      ok: pack.staff.length > 0 && completeStaff === pack.staff.length,
      detail: `${completeStaff}/${pack.staff.length} files`,
    },
    {
      label: "Incident sign-offs",
      ok: unsigned === 0,
      detail: `${unsigned} awaiting admin sign-off`,
    },
    {
      label: "Current license on file",
      ok: pack.documents.some(
        (d) =>
          d.category === "license" &&
          (!d.expires_on || d.expires_on >= pack.today),
      ),
      detail: "Included vault records",
    },
    {
      label: "Current insurance on file",
      ok: pack.documents.some(
        (d) =>
          d.category === "insurance" &&
          (!d.expires_on || d.expires_on >= pack.today),
      ),
      detail: "Included vault records",
    },
    {
      label: "Drill records available",
      ok: pack.drills.some((d) => !d.voided_at),
      detail: "Last 12 months; confirm local frequency",
    },
  ];
  return {
    checks,
    unsigned,
    completeStaff,
    score: Math.round(
      (100 * checks.filter((c) => c.ok).length) / checks.length,
    ),
  };
}
