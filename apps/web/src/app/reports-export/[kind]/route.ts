import {
  getMyProfile,
  getMyDaycare,
  hasPermission,
  listAttendanceDay,
  listMedicalRegister,
  listRoster,
} from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { addDateDays, dateInTimeZone, isDate, startOfWeek, zonedLocalToIso } from "@/lib/center-date";
import { medicationLifecycleStatus } from "@/lib/children/medication-status";
import { csvRows } from "@/lib/csv";
import { getServerSupabase } from "@/lib/supabase/server";
import type { ReportKind } from "@/lib/reports/catalog";
import { archiveReport, ReportArchiveTooLargeError } from "@/lib/reports/archive";
import { fetchAllReportRows } from "@/lib/reports/pagination";
import { isValidPayrollDate } from "@/lib/reports/payroll";
import {
  attendanceIntervalHours,
  loadMonthlyAttendanceRecords,
  nextAttendanceMonth,
} from "@/lib/attendance/monthly-record";

// CSV exports behind the Reports library (13a/13b). Admin-only; RLS scopes
// every row to the caller's center and each Group 13 export is audited.

function exportFailure(): Response {
  return new Response("Report export is temporarily unavailable", {
    status: 500,
    headers: { "Cache-Control": "private, no-store" },
  });
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
  const attendancePermitted = !kind.startsWith("attendance")
    || await hasPermission(supabase, "attendance", "view");
  if (!isAdminRole(profile?.role) || !permitted || !attendancePermitted) {
    return new Response(!attendancePermitted
      ? "Attendance permission required"
      : kind === "timesheets" ? "Staff permission required" : "Reports permission required", {
      status: 403,
    });
  }

  const url = new URL(request.url);
  const attendanceToday = kind.startsWith("attendance")
    ? dateInTimeZone(
        new Date(),
        (await getMyDaycare(supabase))?.timezone ?? "America/Toronto",
      )
    : null;
  let rows: string[][];
  let name: string;
  let exportMeta: {
    kind: ReportKind;
    startsOn: string | null;
    endsOn: string | null;
  } | null = null;

  if (kind === "attendance") {
    const requestedDate = url.searchParams.get("date");
    const date = isDate(requestedDate ?? undefined)
      ? requestedDate!
      : attendanceToday!;
    const day = await listAttendanceDay(supabase, date);
    rows = [
      ["Child", "Room", "Status", "In", "Out", "Dropped off by", "Picked up by", "Recorded in by", "Recorded out by", "Notes"],
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
          att?.checked_in_by_profile?.full_name ?? "",
          att?.checked_out_by_profile?.full_name ?? "",
          att?.notes ?? "",
        ];
      }),
    ];
    name = `attendance-${date}.csv`;
    exportMeta = { kind: "attendance", startsOn: date, endsOn: date };
  } else if (kind === "attendance-summary") {
    const from = isDate(url.searchParams.get("from") ?? undefined)
      ? url.searchParams.get("from")!
      : attendanceToday!.slice(0, 7) + "-01";
    const to = isDate(url.searchParams.get("to") ?? undefined)
      ? url.searchParams.get("to")!
      : attendanceToday!;
    type AttendanceSummaryRow = {
      id: string;
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
    const summaryRecords: AttendanceSummaryRow[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase
        .from("attendance_records")
        .select(
          "id,date,status,checked_in_at,checked_out_at,child:children(first_name,last_name,classroom:classrooms(name))",
        )
        .gte("date", from)
        .lte("date", to)
        .order("date")
        .order("id")
        .range(offset, offset + 499);
      if (error) return exportFailure();
      const page = (data ?? []) as unknown as AttendanceSummaryRow[];
      summaryRecords.push(...page);
      if (page.length < 500) break;
    }
    rows = [
      ["Date", "Child", "Room", "Status", "In", "Out"],
      ...summaryRecords.map((record) => [
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
    // 8e monthly attendance record — one row per recorded child-day.
    const requestedMonth = url.searchParams.get("month");
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth ?? "")
      ? requestedMonth!
      : attendanceToday!.slice(0, 7);
    const childId = url.searchParams.get("child");
    if (childId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(childId)) {
      return new Response("Invalid child", { status: 400 });
    }
    let monthly;
    try {
      monthly = await loadMonthlyAttendanceRecords(supabase, month, childId ?? undefined);
    } catch {
      return exportFailure();
    }
    rows = [
      ["Date", "Child", "Room", "Status", "Absence reason", "In", "Out", "Hours", "Dropped off by", "Picked up by", "Correction audit note"],
      ...monthly.flatMap((child) => child.rows.map((record) => {
        const hours = attendanceIntervalHours(record.checkedInAt, record.checkedOutAt);
        return [
          record.date,
          child.name,
          child.room,
          record.status,
          record.absenceReason ?? "",
          record.checkedInAt ?? "",
          record.checkedOutAt ?? "",
          hours === null ? "" : hours.toFixed(1),
          record.droppedOffBy ?? "",
          record.pickedUpBy ?? "",
          record.corrections
            .map((correction) => `${correction.reason} (edited ${correction.correctedAt}${correction.correctedBy ? ` by ${correction.correctedBy}` : ""})`)
            .join("; "),
        ];
      })),
    ];
    name = `attendance-${childId ? "child-" : ""}${month}.csv`;
    exportMeta = {
      kind: "attendance",
      startsOn: `${month}-01`,
      endsOn: addDateDays(nextAttendanceMonth(month), -1),
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
    const { data, error } = await fetchAllReportRows((pageFrom, pageTo) => {
      let query = supabase
        .from("invoices")
        .select("id,number,status,issued_on,due_on,total_cents,family:families(display_name),child:children(first_name,last_name),billed_to_profile:profiles!invoices_billed_to_fkey(full_name)")
        .order("issued_on", { ascending: false })
        .order("id");
      if (from) query = query.gte("issued_on", from);
      if (to) query = query.lte("issued_on", to);
      return query.range(pageFrom, pageTo);
    });
    if (error) return exportFailure();
    type Invoice = {
      id: string;
      number: string | null;
      status: string;
      issued_on: string | null;
      due_on: string | null;
      total_cents: number;
      family: { display_name: string } | null;
      child: { first_name: string; last_name: string } | null;
      billed_to_profile: { full_name: string } | null;
    };
    const invoices = (data ?? []) as unknown as Invoice[];
    const selectedInvoices = invoices.filter(
      (invoice) =>
        (!requestedIds.size || requestedIds.has(invoice.id)) &&
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
    if ((requestedFrom && !isValidPayrollDate(requestedFrom)) || (requestedTo && !isValidPayrollDate(requestedTo))) {
      return new Response("Invalid pay period date", { status: 400 });
    }
    const weekStart = isValidPayrollDate(requestedFrom ?? "")
      ? requestedFrom!
      : startOfWeek(isValidPayrollDate(url.searchParams.get("week") ?? "") ? url.searchParams.get("week")! : today);
    const weekEnd = isValidPayrollDate(requestedTo ?? "") ? requestedTo! : addDateDays(weekStart, 6);
    if (weekEnd < weekStart) {
      return new Response("Pay period end must be on or after its start", { status: 400 });
    }
    const { data, error } = await fetchAllReportRows((pageFrom, pageTo) => supabase
      .from("staff_time_entries")
      .select("id,staff_member_id,clocked_in_at,clocked_out_at,break_minutes,status,staff:staff_members(profile:profiles(full_name,classroom:classrooms!profiles_classroom_id_fkey(name))),classroom:classrooms(name)")
      .gte("clocked_in_at", `${addDateDays(weekStart, -1)}T00:00:00Z`)
      .lt("clocked_in_at", `${addDateDays(weekEnd, 2)}T00:00:00Z`)
      .order("clocked_in_at")
      .order("id")
      .range(pageFrom, pageTo));
    if (error) return exportFailure();
    type TimeEntry = {
      id: string;
      staff_member_id: string;
      clocked_in_at: string;
      clocked_out_at: string | null;
      break_minutes: number;
      status: string;
      staff: { profile: { full_name: string; classroom: { name: string } | null } | null } | null;
      classroom: { name: string } | null;
    };
    const entries = (data ?? []) as unknown as TimeEntry[];
    const selected = entries.filter((entry) => {
      const date = dateInTimeZone(entry.clocked_in_at, timeZone);
      return date >= weekStart && date <= weekEnd;
    });
    if (selected.length === 0 || selected.some((entry) => entry.status !== "approved" || !entry.clocked_out_at)) {
      return new Response("Every time entry in the pay period must be approved before export", {
        status: 409,
      });
    }
    rows = [
      ["Staff", "Staff record ID", "Time entry ID", "Date", "Clock in", "Clock out", "Break minutes", "Paid hours", "Room", "Status"],
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
          entry.staff_member_id,
          entry.id,
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
    const timeZone = (await getMyDaycare(supabase))?.timezone ?? "America/Toronto";
    const today = dateInTimeZone(new Date(), timeZone);
    const from = isDate(url.searchParams.get("from") ?? undefined)
      ? url.searchParams.get("from")!
      : today.slice(0, 7) + "-01";
    const to = isDate(url.searchParams.get("to") ?? undefined)
      ? url.searchParams.get("to")!
      : today;
    const rangeStart = zonedLocalToIso(from, "00:00", timeZone);
    const rangeEnd = zonedLocalToIso(addDateDays(to, 1), "00:00", timeZone);
    const { data, error } = await fetchAllReportRows((pageFrom, pageTo) => supabase
      .from("room_ratio_history")
      .select(
        "id,starts_at,ends_at,present_count,staff_count,required_staff,max_children_per_staff,source,classroom:classrooms(name)",
      )
      .lt("starts_at", rangeEnd)
      .or(`ends_at.is.null,ends_at.gt.${rangeStart}`)
      .order("starts_at")
      .order("id")
      .range(pageFrom, pageTo));
    if (error) return exportFailure();
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
      ...((data ?? []) as unknown as RatioRow[]).filter((record) => record.source !== "legacy_event").map((record) => [
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
    const timeZone = (await getMyDaycare(supabase))?.timezone ?? "America/Toronto";
    const today = dateInTimeZone(new Date(), timeZone);
    const from = isDate(url.searchParams.get("from") ?? undefined)
      ? url.searchParams.get("from")!
      : today.slice(0, 7) + "-01";
    const to = isDate(url.searchParams.get("to") ?? undefined)
      ? url.searchParams.get("to")!
      : today;
    const rangeStart = zonedLocalToIso(from, "00:00", timeZone);
    const rangeEnd = zonedLocalToIso(addDateDays(to, 1), "00:00", timeZone);
    const { data, error } = await fetchAllReportRows((pageFrom, pageTo) => supabase
      .from("incident_reports")
      .select(
        "id,occurred_at,severity,injury_type,location,status,parent_notified_at,parent_acknowledged_at,child:children(first_name,last_name),classroom:classrooms(name)",
      )
      .gte("occurred_at", rangeStart)
      .lt("occurred_at", rangeEnd)
      .neq("status", "draft")
      .order("occurred_at")
      .order("id")
      .range(pageFrom, pageTo));
    if (error) return exportFailure();
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
    const timeZone = (await getMyDaycare(supabase))?.timezone ?? "America/Toronto";
    const today = dateInTimeZone(new Date(), timeZone);
    const from = isDate(url.searchParams.get("from") ?? undefined)
      ? url.searchParams.get("from")!
      : today.slice(0, 7) + "-01";
    const to = isDate(url.searchParams.get("to") ?? undefined)
      ? url.searchParams.get("to")!
      : today;
    const rangeStart = zonedLocalToIso(from, "00:00", timeZone);
    const rangeEnd = zonedLocalToIso(addDateDays(to, 1), "00:00", timeZone);
    const { data, error } = await fetchAllReportRows((pageFrom, pageTo) => supabase
      .from("enrollments")
      .select(
        "id,created_at,guardian_name,guardian_email,child_first_name,child_last_name,stage,desired_start_date,source,waitlist_position,classroom:classrooms(name)",
      )
      .gte("created_at", rangeStart)
      .lt("created_at", rangeEnd)
      .order("created_at")
      .order("id")
      .range(pageFrom, pageTo));
    if (error) return exportFailure();
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

  const csv = csvRows(rows);
  if (exportMeta && profile?.daycare_id) {
    try {
      await archiveReport(supabase, {
        daycareId: profile.daycare_id,
        profileId: profile.id,
        kind: exportMeta.kind,
        format: "csv",
        startsOn: exportMeta.startsOn,
        endsOn: exportMeta.endsOn,
        rowCount: Math.max(0, rows.length - 1),
        parameters: Object.fromEntries(url.searchParams.entries()),
        bytes: Buffer.from(csv, "utf8"),
      });
    } catch (error) {
      return error instanceof ReportArchiveTooLargeError
        ? new Response(error.message, { status: 413 })
        : exportFailure();
    }
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
