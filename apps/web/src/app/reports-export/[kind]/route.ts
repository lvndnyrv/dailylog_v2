import {
  getMyProfile,
  getMyDaycare,
  hasPermission,
  listAttendanceDay,
  listInvoices,
  listMedicalRegister,
  listRoster,
  listStaffTimeEntries,
} from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { addDateDays, dateInTimeZone, isDate, startOfWeek } from "@/lib/center-date";
import { medicationLifecycleStatus } from "@/lib/children/medication-status";
import { getServerSupabase } from "@/lib/supabase/server";
import { REPORT_CATALOG, type ReportKind } from "@/lib/reports/catalog";

// CSV exports behind the Reports library (13a/13b). Admin-only; RLS scopes
// every row to the caller's center and each Group 13 export is audited.

function nextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
}

function attendanceHours(checkedInAt: string | null, checkedOutAt: string | null): string {
  if (!checkedInAt || !checkedOutAt) return "";
  const hours = (Date.parse(checkedOutAt) - Date.parse(checkedInAt)) / 3_600_000;
  return Number.isFinite(hours) && hours >= 0 ? hours.toFixed(1) : "";
}

function csv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell))
        .join(","),
    )
    .join("\n");
}

function emergencyContactSummary(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((contact) => {
      if (!contact || typeof contact !== "object") return "";
      const row = contact as Record<string, unknown>;
      return [row.name, row.relation, row.phone]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(" · ");
    })
    .filter(Boolean)
    .join("; ");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  const permitted =
    kind === "timesheets"
      ? await hasPermission(supabase, "staff", "view")
      : await hasPermission(supabase, "reports", "view");
  if (!isAdminRole(profile?.role) || !permitted) {
    return new Response(kind === "timesheets" ? "Staff permission required" : "Reports permission required", {
      status: 403,
    });
  }

  const url = new URL(request.url);
  let rows: string[][];
  let name: string;
  let exportMeta: {
    kind: ReportKind;
    startsOn: string | null;
    endsOn: string | null;
  } | null = null;

  if (kind === "attendance") {
    const date =
      url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const day = await listAttendanceDay(supabase, date);
    rows = [
      ["Child", "Room", "Status", "In", "Out", "Dropped off by", "Picked up by", "Notes"],
      ...day.map((row) => {
        const att = row.attendance[0];
        return [
          `${row.first_name} ${row.last_name}`,
          row.classroom?.name ?? "",
          att?.status ?? "no record",
          att?.checked_in_at ?? "",
          att?.checked_out_at ?? "",
          att?.dropped_off_by ?? "",
          att?.picked_up_by ?? "",
          att?.notes ?? "",
        ];
      }),
    ];
    name = `attendance-${date}.csv`;
    exportMeta = { kind: "attendance", startsOn: date, endsOn: date };
  } else if (kind === "attendance-summary") {
    const from = isDate(url.searchParams.get("from") ?? undefined)
      ? url.searchParams.get("from")!
      : new Date().toISOString().slice(0, 7) + "-01";
    const to = isDate(url.searchParams.get("to") ?? undefined)
      ? url.searchParams.get("to")!
      : new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("attendance_records")
      .select(
        "date,status,checked_in_at,checked_out_at,child:children(first_name,last_name,classroom:classrooms(name))",
      )
      .gte("date", from)
      .lte("date", to)
      .order("date");
    if (error) return new Response(error.message, { status: 500 });
    type AttendanceSummaryRow = {
      date: string;
      status: string;
      checked_in_at: string | null;
      checked_out_at: string | null;
      child: {
        first_name: string;
        last_name: string;
        classroom: { name: string } | null;
      } | null;
    };
    rows = [
      ["Date", "Child", "Room", "Status", "In", "Out"],
      ...((data ?? []) as unknown as AttendanceSummaryRow[]).map((record) => [
        record.date,
        record.child ? `${record.child.first_name} ${record.child.last_name}` : "",
        record.child?.classroom?.name ?? "",
        record.status,
        record.checked_in_at ?? "",
        record.checked_out_at ?? "",
      ]),
    ];
    name = `attendance-summary-${from}-to-${to}.csv`;
    exportMeta = { kind: "attendance", startsOn: from, endsOn: to };
  } else if (kind === "attendance-month") {
    // 8e monthly attendance record — one row per child per attended day
    const month =
      url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const childId = url.searchParams.get("child");
    let query = supabase
      .from("attendance_records")
      .select(
        `date, status, checked_in_at, checked_out_at, dropped_off_by, picked_up_by,
         child:children(id, first_name, last_name, classroom:classrooms(name)),
         corrections:attendance_corrections(reason, corrected_at,
           corrected_by_profile:profiles!attendance_corrections_corrected_by_fkey(full_name))`,
      )
      .gte("date", `${month}-01`)
      .lt("date", nextMonth(month))
      .order("date");
    if (childId) query = query.eq("child_id", childId);
    const { data, error } = await query;
    if (error) return new Response(error.message, { status: 500 });

    type Row = {
      date: string;
      status: string;
      checked_in_at: string | null;
      checked_out_at: string | null;
      dropped_off_by: string | null;
      picked_up_by: string | null;
      child: {
        id: string;
        first_name: string;
        last_name: string;
        classroom: { name: string } | null;
      } | null;
      corrections: Array<{
        reason: string;
        corrected_at: string;
        corrected_by_profile: { full_name: string } | null;
      }>;
    };
    rows = [
      ["Date", "Child", "Room", "Status", "In", "Out", "Hours", "Dropped off by", "Picked up by", "Correction note"],
      ...((data ?? []) as unknown as Row[]).map((record) => [
        record.date,
        record.child ? `${record.child.first_name} ${record.child.last_name}` : "",
        record.child?.classroom?.name ?? "",
        record.status,
        record.checked_in_at ?? "",
        record.checked_out_at ?? "",
        attendanceHours(record.checked_in_at, record.checked_out_at),
        record.dropped_off_by ?? "",
        record.picked_up_by ?? "",
        record.corrections
          .map((correction) => `${correction.reason}${correction.corrected_by_profile?.full_name ? ` (edited by ${correction.corrected_by_profile.full_name})` : ""}`)
          .join("; "),
      ]),
    ];
    name = `attendance-${childId ? "child-" : ""}${month}.csv`;
    exportMeta = {
      kind: "attendance",
      startsOn: `${month}-01`,
      endsOn: addDateDays(nextMonth(month), -1),
    };
  } else if (kind === "children") {
    const roster = await listRoster(supabase);
    rows = [
      ["Child", "Room", "Date of birth", "Enrolled on", "Allergies", "Primary contact"],
      ...roster.map((child) => [
        `${child.first_name} ${child.last_name}`,
        child.classroom?.name ?? "",
        child.date_of_birth ?? "",
        child.enrolled_on ?? "",
        (child.allergies ?? []).join("; "),
        child.guardians.find((g) => g.is_primary)?.parent?.full_name ??
          child.guardians[0]?.parent?.full_name ??
          "",
      ]),
    ];
    name = "children-roster.csv";
  } else if (kind === "children-medical") {
    const register = await listMedicalRegister(supabase);
    const flagged = register.filter(
      (child) =>
        (child.allergies?.length ?? 0) > 0 ||
        child.medical_notes ||
        child.medications.length > 0,
    );
    rows = [
      [
        "Child",
        "Room",
        "Allergies",
        "Medical notes",
        "Medications",
        "Authorization status",
        "Emergency contacts",
      ],
      ...flagged.map((child) => [
        `${child.first_name} ${child.last_name}`,
        child.classroom?.name ?? "",
        (child.allergies ?? []).join("; "),
        child.medical_notes ?? "",
        child.medications.map((medication) => medication.name).join("; "),
        child.medications.some(
          (medication) => medicationLifecycleStatus(medication) === "consent_needed",
        )
          ? "Consent needed"
          : "Complete",
        emergencyContactSummary(child.emergency_contacts),
      ]),
    ];
    name = "children-medical-register.csv";
  } else if (kind === "invoices") {
    const invoices = await listInvoices(supabase);
    const from = isDate(url.searchParams.get("from") ?? undefined)
      ? url.searchParams.get("from")!
      : null;
    const to = isDate(url.searchParams.get("to") ?? undefined)
      ? url.searchParams.get("to")!
      : null;
    const requestedIds = new Set(
      (url.searchParams.get("ids") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const selectedInvoices = (requestedIds.size
      ? invoices.filter((invoice) => requestedIds.has(invoice.id))
      : invoices
    ).filter(
      (invoice) =>
        (!from || (invoice.issued_on ?? "") >= from) &&
        (!to || (invoice.issued_on ?? "") <= to),
    );
    rows = [
      ["Number", "Family", "Child", "Status", "Issued", "Due", "Total"],
      ...selectedInvoices.map((invoice) => [
        invoice.number ?? "",
        invoice.family?.display_name ?? invoice.billed_to_profile?.full_name ?? "",
        invoice.child ? `${invoice.child.first_name} ${invoice.child.last_name}` : "",
        invoice.status,
        invoice.issued_on ?? "",
        invoice.due_on ?? "",
        (invoice.total_cents / 100).toFixed(2),
      ]),
    ];
    name = "invoices.csv";
    exportMeta = { kind: "billing", startsOn: from, endsOn: to };
  } else if (kind === "timesheets") {
    const daycare = await getMyDaycare(supabase);
    const timeZone = daycare?.timezone ?? "America/Toronto";
    const today = dateInTimeZone(new Date(), timeZone);
    const requestedFrom = url.searchParams.get("from");
    const requestedTo = url.searchParams.get("to");
    const weekStart = isDate(requestedFrom ?? undefined)
      ? requestedFrom!
      : startOfWeek(isDate(url.searchParams.get("week") ?? undefined) ? url.searchParams.get("week")! : today);
    const weekEnd = isDate(requestedTo ?? undefined) ? requestedTo! : addDateDays(weekStart, 6);
    const entries = await listStaffTimeEntries(
      supabase,
      `${addDateDays(weekStart, -1)}T00:00:00Z`,
      `${addDateDays(weekEnd, 2)}T00:00:00Z`,
    );
    const selected = entries.filter((entry) => {
      const date = dateInTimeZone(entry.clocked_in_at, timeZone);
      return date >= weekStart && date <= weekEnd;
    });
    if (selected.length === 0 || selected.some((entry) => entry.status !== "approved")) {
      return new Response("Every time entry in the pay period must be approved before export", {
        status: 409,
      });
    }
    rows = [
      ["Staff", "Date", "Clock in", "Clock out", "Break minutes", "Paid hours", "Room", "Status"],
      ...selected.map((entry) => {
        const paidMinutes = entry.clocked_out_at
          ? Math.max(
              0,
              Math.round(
                (new Date(entry.clocked_out_at).getTime() - new Date(entry.clocked_in_at).getTime()) /
                  60000,
              ) - entry.break_minutes,
            )
          : 0;
        return [
          entry.staff?.profile?.full_name ?? "",
          dateInTimeZone(entry.clocked_in_at, timeZone),
          entry.clocked_in_at,
          entry.clocked_out_at ?? "",
          String(entry.break_minutes),
          (paidMinutes / 60).toFixed(2),
          entry.classroom?.name ?? entry.staff?.profile?.classroom?.name ?? "",
          entry.status,
        ];
      }),
    ];
    name = `timesheets-${weekStart}.csv`;
    exportMeta = { kind: "timesheets", startsOn: weekStart, endsOn: weekEnd };
  } else if (kind === "ratio") {
    const from = isDate(url.searchParams.get("from") ?? undefined)
      ? url.searchParams.get("from")!
      : new Date().toISOString().slice(0, 7) + "-01";
    const to = isDate(url.searchParams.get("to") ?? undefined)
      ? url.searchParams.get("to")!
      : new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("room_ratio_history")
      .select(
        "starts_at,ends_at,present_count,staff_count,required_staff,max_children_per_staff,source,classroom:classrooms(name)",
      )
      .lt("starts_at", `${addDateDays(to, 1)}T00:00:00`)
      .or(`ends_at.is.null,ends_at.gte.${from}T00:00:00`)
      .order("starts_at");
    if (error) return new Response(error.message, { status: 500 });
    type RatioRow = {
      starts_at: string;
      ends_at: string | null;
      present_count: number;
      staff_count: number;
      required_staff: number;
      max_children_per_staff: number;
      source: string;
      classroom: { name: string } | null;
    };
    rows = [
      ["Room", "Starts", "Ends", "Children", "Staff", "Required staff", "Status", "Source"],
      ...((data ?? []) as unknown as RatioRow[]).map((record) => [
        record.classroom?.name ?? "",
        record.starts_at,
        record.ends_at ?? "Open",
        String(record.present_count),
        String(record.staff_count),
        String(record.required_staff),
        record.staff_count >= record.required_staff ? "Compliant" : "Over ratio",
        record.source,
      ]),
    ];
    name = `ratio-compliance-${from}-to-${to}.csv`;
    exportMeta = { kind: "ratio", startsOn: from, endsOn: to };
  } else if (kind === "incidents") {
    const from = isDate(url.searchParams.get("from") ?? undefined)
      ? url.searchParams.get("from")!
      : new Date().toISOString().slice(0, 7) + "-01";
    const to = isDate(url.searchParams.get("to") ?? undefined)
      ? url.searchParams.get("to")!
      : new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("incident_reports")
      .select(
        "occurred_at,severity,injury_type,location,status,parent_notified_at,parent_acknowledged_at,child:children(first_name,last_name),classroom:classrooms(name)",
      )
      .gte("occurred_at", `${from}T00:00:00`)
      .lt("occurred_at", `${addDateDays(to, 1)}T00:00:00`)
      .neq("status", "draft")
      .order("occurred_at");
    if (error) return new Response(error.message, { status: 500 });
    type IncidentRow = {
      occurred_at: string;
      severity: string;
      injury_type: string;
      location: string;
      status: string;
      parent_notified_at: string | null;
      parent_acknowledged_at: string | null;
      child: { first_name: string; last_name: string } | null;
      classroom: { name: string } | null;
    };
    rows = [
      ["Occurred", "Child", "Room", "Severity", "Type", "Location", "Status", "Parent notified", "Acknowledged"],
      ...((data ?? []) as unknown as IncidentRow[]).map((record) => [
        record.occurred_at,
        record.child ? `${record.child.first_name} ${record.child.last_name}` : "",
        record.classroom?.name ?? "",
        record.severity,
        record.injury_type,
        record.location,
        record.status,
        record.parent_notified_at ?? "",
        record.parent_acknowledged_at ?? "",
      ]),
    ];
    name = `incidents-${from}-to-${to}.csv`;
    exportMeta = { kind: "incidents", startsOn: from, endsOn: to };
  } else if (kind === "enrollment") {
    const from = isDate(url.searchParams.get("from") ?? undefined)
      ? url.searchParams.get("from")!
      : new Date().toISOString().slice(0, 7) + "-01";
    const to = isDate(url.searchParams.get("to") ?? undefined)
      ? url.searchParams.get("to")!
      : new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("enrollments")
      .select(
        "created_at,guardian_name,guardian_email,child_first_name,child_last_name,stage,desired_start_date,source,waitlist_position,classroom:classrooms(name)",
      )
      .gte("created_at", `${from}T00:00:00`)
      .lt("created_at", `${addDateDays(to, 1)}T00:00:00`)
      .order("created_at");
    if (error) return new Response(error.message, { status: 500 });
    type EnrollmentRow = {
      created_at: string;
      guardian_name: string | null;
      guardian_email: string | null;
      child_first_name: string | null;
      child_last_name: string | null;
      stage: string;
      desired_start_date: string | null;
      source: string | null;
      waitlist_position: number | null;
      classroom: { name: string } | null;
    };
    rows = [
      ["Received", "Guardian", "Email", "Child", "Room", "Stage", "Desired start", "Source", "Waitlist position"],
      ...((data ?? []) as unknown as EnrollmentRow[]).map((record) => [
        record.created_at,
        record.guardian_name ?? "",
        record.guardian_email ?? "",
        [record.child_first_name, record.child_last_name].filter(Boolean).join(" "),
        record.classroom?.name ?? "",
        record.stage,
        record.desired_start_date ?? "",
        record.source ?? "",
        record.waitlist_position == null ? "" : String(record.waitlist_position),
      ]),
    ];
    name = `enrollment-funnel-${from}-to-${to}.csv`;
    exportMeta = { kind: "enrollment", startsOn: from, endsOn: to };
  } else {
    return new Response("Unknown report", { status: 404 });
  }

  if (exportMeta && profile?.daycare_id) {
    const { error } = await supabase.from("report_exports").insert({
      daycare_id: profile.daycare_id,
      created_by: profile.id,
      report_kind: exportMeta.kind,
      title: REPORT_CATALOG[exportMeta.kind].title,
      starts_on: exportMeta.startsOn,
      ends_on: exportMeta.endsOn,
      format: "csv",
      row_count: Math.max(0, rows.length - 1),
      parameters: Object.fromEntries(url.searchParams.entries()),
    });
    if (error) return new Response(`Unable to audit export: ${error.message}`, { status: 500 });
  }

  return new Response(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
