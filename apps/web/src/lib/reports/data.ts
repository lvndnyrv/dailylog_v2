import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@dailylog/db";
import { addDateDays, dateInTimeZone, zonedLocalToIso } from "@/lib/center-date";
import { REPORT_CATALOG, type ReportKind } from "./catalog";
import { fetchAllReportRows } from "./pagination";
import { summarizePayrollEntries } from "./payroll";

type Client = SupabaseClient<Database>;

export interface ReportMetric {
  label: string;
  value: string;
  tone?: "default" | "warning" | "success";
}

export interface ReportPreview {
  kind: ReportKind;
  title: string;
  generatedAt: string;
  startsOn: string;
  endsOn: string;
  metrics: ReportMetric[];
  columns: string[];
  rows: string[][];
  rowCount: number;
  emptyHint: string;
  exportBlockedReason?: string;
}

export function defaultReportRange(timeZone: string, now = new Date()) {
  const today = dateInTimeZone(now, timeZone);
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(1);
  return { startsOn: date.toISOString().slice(0, 10), endsOn: today };
}

const money = (cents: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
const overlapMinutes = (start: string, end: string | null, rangeStart: string, rangeEnd: string, now: string) =>
  Math.max(
    0,
    Math.round(
      (Math.min(new Date(end ?? now).getTime(), new Date(rangeEnd).getTime(), new Date(now).getTime()) -
        Math.max(new Date(start).getTime(), new Date(rangeStart).getTime())) / 60000,
    ),
  );
const percentage = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : "—";

export async function getReportPreview(
  client: Client,
  kind: ReportKind,
  startsOn: string,
  endsOn: string,
  timeZone: string,
  daycareId: string,
): Promise<ReportPreview> {
  const definition = REPORT_CATALOG[kind];
  const generatedAt = new Date().toISOString();
  const through = addDateDays(endsOn, 1);
  const rangeStart = zonedLocalToIso(startsOn, "00:00", timeZone);
  const rangeEnd = zonedLocalToIso(through, "00:00", timeZone);
  const base = {
    kind,
    title: definition.title,
    generatedAt,
    startsOn,
    endsOn,
    emptyHint: definition.emptyHint,
  };

  if (kind === "attendance") {
    const [{ data, error }, { data: rooms, error: roomError }] = await Promise.all([
      fetchAllReportRows((from, to) => client
        .from("attendance_records")
        .select(
          "id,date,status,checked_in_at,checked_out_at,child:children(first_name,last_name,classroom:classrooms(id,name,capacity))",
        )
        .eq("daycare_id", daycareId)
        .gte("date", startsOn)
        .lte("date", endsOn)
        .order("date")
        .order("id")
        .range(from, to)),
      client
        .from("classrooms")
        .select("id,name,capacity")
        .eq("daycare_id", daycareId)
        .is("archived_at", null)
        .order("min_age_months", { ascending: true, nullsFirst: false }),
    ]);
    if (error) throw error;
    if (roomError) throw roomError;
    type Attendance = {
      date: string;
      status: string;
      checked_in_at: string | null;
      checked_out_at: string | null;
      child: {
        first_name: string;
        last_name: string;
        classroom: { id: string; name: string; capacity: number | null } | null;
      } | null;
    };
    const records = (data ?? []) as unknown as Attendance[];
    const byRoom = new Map<
      string,
      { name: string; capacity: number; present: number; absent: number; dates: Set<string> }
    >();
    for (const room of rooms ?? [])
      byRoom.set(room.id, {
        name: room.name,
        capacity: room.capacity ?? 0,
        present: 0,
        absent: 0,
        dates: new Set(),
      });
    for (const record of records) {
      const room = record.child?.classroom;
      if (!room) continue;
      const summary = byRoom.get(room.id) ?? {
        name: room.name,
        capacity: room.capacity ?? 0,
        present: 0,
        absent: 0,
        dates: new Set<string>(),
      };
      summary.dates.add(record.date);
      if (record.status === "absent" || record.status === "excused") summary.absent += 1;
      else if (record.checked_in_at) summary.present += 1;
      byRoom.set(room.id, summary);
    }
    const present = records.filter((r) => !!r.checked_in_at).length;
    const absent = records.filter((r) => ["absent", "excused"].includes(r.status)).length;
    const late = records.filter((r) => r.status === "late").length;
    const rows = [...byRoom.values()].map((room) => {
      const days = Math.max(room.dates.size, 1);
      const average = room.present / days;
      return [
        room.name,
        average.toFixed(1),
        String(room.absent),
        room.capacity ? percentage(average, room.capacity) : "—",
      ];
    });
    return {
      ...base,
      metrics: [
        { label: "check-ins", value: String(present) },
        { label: "absences", value: String(absent) },
        { label: "late arrivals", value: String(late), tone: late ? "warning" : "default" },
      ],
      columns: ["ROOM", "AVG DAILY", "ABSENCES", "OCCUPANCY"],
      rows,
      rowCount: records.length,
    };
  }

  if (kind === "billing") {
    const { data, error } = await fetchAllReportRows((from, to) => client
      .from("invoices")
      .select(
        "id,number,status,issued_on,due_on,total_cents,family:families(display_name),payments:payments!payments_invoice_id_fkey(amount_cents,paid_at)",
      )
      .eq("daycare_id", daycareId)
      .gte("issued_on", startsOn)
      .lte("issued_on", endsOn)
      .order("issued_on", { ascending: false })
      .order("id")
      .range(from, to));
    if (error) throw error;
    type Invoice = {
      number: string | null;
      status: string;
      issued_on: string | null;
      due_on: string | null;
      total_cents: number;
      family: { display_name: string } | null;
      payments: { amount_cents: number; paid_at: string | null }[];
    };
    const invoices = (data ?? []) as unknown as Invoice[];
    const total = invoices.reduce((sum, invoice) => sum + invoice.total_cents, 0);
    const collected = invoices.reduce(
      (sum, invoice) =>
        sum +
        invoice.payments
          .filter((payment) => !payment.paid_at || payment.paid_at.slice(0, 10) <= endsOn)
          .reduce((paid, payment) => paid + payment.amount_cents, 0),
      0,
    );
    return {
      ...base,
      metrics: [
        { label: "invoiced", value: money(total) },
        { label: "collected", value: money(collected), tone: "success" },
        { label: "outstanding", value: money(Math.max(0, total - collected)), tone: "warning" },
      ],
      columns: ["INVOICE", "FAMILY", "STATUS", "TOTAL", "DUE"],
      rows: invoices.map((invoice) => [
        invoice.number ?? "Draft",
        invoice.family?.display_name ?? "—",
        invoice.status,
        money(invoice.total_cents),
        invoice.due_on ?? "—",
      ]),
      rowCount: invoices.length,
    };
  }

  if (kind === "ratio") {
    const { data, error } = await fetchAllReportRows((from, to) => client
      .from("room_ratio_history")
      .select(
        "id,starts_at,ends_at,present_count,staff_count,required_staff,source,classroom:classrooms(name)",
      )
      .eq("daycare_id", daycareId)
      .lt("starts_at", rangeEnd)
      .or(`ends_at.is.null,ends_at.gt.${rangeStart}`)
      .order("starts_at", { ascending: false })
      .order("id")
      .range(from, to));
    if (error) throw error;
    type Interval = {
      starts_at: string;
      ends_at: string | null;
      present_count: number;
      staff_count: number;
      required_staff: number;
      source: string;
      classroom: { name: string } | null;
    };
    const intervals = ((data ?? []) as unknown as Interval[]).filter(
      (row) => row.source !== "legacy_event",
    );
    const byRoom = new Map<string, { observed: number; compliant: number; events: number }>();
    for (const interval of intervals) {
      const room = interval.classroom?.name ?? "Archived room";
      const observed = overlapMinutes(interval.starts_at, interval.ends_at, rangeStart, rangeEnd, generatedAt);
      const current = byRoom.get(room) ?? { observed: 0, compliant: 0, events: 0 };
      current.observed += observed;
      if (interval.staff_count >= interval.required_staff) current.compliant += observed;
      else current.events += 1;
      byRoom.set(room, current);
    }
    const observed = [...byRoom.values()].reduce((sum, row) => sum + row.observed, 0);
    const compliant = [...byRoom.values()].reduce((sum, row) => sum + row.compliant, 0);
    return {
      ...base,
      metrics: [
        { label: "observed minutes", value: observed.toLocaleString() },
        { label: "compliant", value: percentage(compliant, observed), tone: "success" },
        { label: "over-ratio minutes", value: String(observed - compliant), tone: observed > compliant ? "warning" : "default" },
      ],
      columns: ["ROOM", "OBSERVED", "COMPLIANT", "OVER", "EVENTS"],
      rows: [...byRoom].map(([room, value]) => [
        room,
        String(value.observed),
        String(value.compliant),
        String(value.observed - value.compliant),
        String(value.events),
      ]),
      rowCount: intervals.length,
    };
  }

  if (kind === "timesheets") {
    const { data, error } = await fetchAllReportRows((from, to) => client
      .from("staff_time_entries")
      .select(
        "id,staff_member_id,clocked_in_at,clocked_out_at,break_minutes,status,staff:staff_members(profile:profiles(full_name))",
      )
      .eq("daycare_id", daycareId)
      .gte("clocked_in_at", rangeStart)
      .lt("clocked_in_at", rangeEnd)
      .order("clocked_in_at")
      .order("id")
      .range(from, to));
    if (error) throw error;
    type Entry = {
      staff_member_id: string;
      clocked_in_at: string;
      clocked_out_at: string | null;
      break_minutes: number;
      status: string;
      staff: { profile: { full_name: string } | null } | null;
    };
    const entries = (data ?? []) as unknown as Entry[];
    const byStaff = summarizePayrollEntries(entries);
    const totalMinutes = [...byStaff.values()].reduce((sum, row) => sum + row.minutes, 0);
    const aboveForty = [...byStaff.values()].reduce(
      (sum, row) => sum + Math.max(0, row.minutes - 40 * 60),
      0,
    );
    const unapproved = entries.filter((entry) => entry.status !== "approved").length;
    return {
      ...base,
      metrics: [
        { label: "paid hours", value: (totalMinutes / 60).toFixed(1) },
        { label: "hours above 40 per staff (review)", value: `${(aboveForty / 60).toFixed(1)} h`, tone: aboveForty ? "warning" : "default" },
        { label: "unapproved entries", value: String(unapproved), tone: unapproved ? "warning" : "success" },
      ],
      columns: ["STAFF", "ENTRIES", "PAID HOURS", "OVER 40 H (REVIEW)", "STATUS"],
      rows: [...byStaff.values()].map((value) => [
        value.name,
        String(value.entries),
        (value.minutes / 60).toFixed(2),
        (Math.max(0, value.minutes - 40 * 60) / 60).toFixed(2),
        value.approved ? "Approved" : "Review needed",
      ]),
      rowCount: entries.length,
      exportBlockedReason: unapproved
        ? "Approve every time entry in this period before exporting payroll."
        : undefined,
    };
  }

  if (kind === "incidents") {
    const { data, error } = await fetchAllReportRows((from, to) => client
      .from("incident_reports")
      .select(
        "id,occurred_at,severity,injury_type,status,parent_acknowledged_at,child:children(first_name,last_name),classroom:classrooms(name)",
      )
      .eq("daycare_id", daycareId)
      .gte("occurred_at", rangeStart)
      .lt("occurred_at", rangeEnd)
      .neq("status", "draft")
      .order("occurred_at", { ascending: false })
      .order("id")
      .range(from, to));
    if (error) throw error;
    type Incident = {
      occurred_at: string;
      severity: string;
      injury_type: string;
      status: string;
      parent_acknowledged_at: string | null;
      child: { first_name: string; last_name: string } | null;
      classroom: { name: string } | null;
    };
    const reports = (data ?? []) as unknown as Incident[];
    return {
      ...base,
      metrics: [
        { label: "reports", value: String(reports.length) },
        { label: "serious", value: String(reports.filter((r) => r.severity === "serious").length), tone: "warning" },
        { label: "acknowledged", value: String(reports.filter((r) => !!r.parent_acknowledged_at).length), tone: "success" },
      ],
      columns: ["DATE", "CHILD", "ROOM", "TYPE", "STATUS"],
      rows: reports.map((report) => [
        dateInTimeZone(report.occurred_at, timeZone),
        report.child ? `${report.child.first_name} ${report.child.last_name}` : "—",
        report.classroom?.name ?? "—",
        `${report.severity} · ${report.injury_type}`,
        report.status.replaceAll("_", " "),
      ]),
      rowCount: reports.length,
    };
  }

  const { data, error } = await fetchAllReportRows((from, to) => client
    .from("enrollments")
    .select(
      "id,created_at,child_first_name,child_last_name,guardian_name,stage,desired_start_date,source,classroom:classrooms(name)",
    )
    .eq("daycare_id", daycareId)
    .gte("created_at", rangeStart)
    .lt("created_at", rangeEnd)
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to));
  if (error) throw error;
  type Enrollment = {
    created_at: string;
    child_first_name: string | null;
    child_last_name: string | null;
    guardian_name: string | null;
    stage: string;
    desired_start_date: string | null;
    source: string | null;
    classroom: { name: string } | null;
  };
  const enrollments = (data ?? []) as unknown as Enrollment[];
  return {
    ...base,
    metrics: [
      { label: "new inquiries", value: String(enrollments.length) },
      { label: "offers", value: String(enrollments.filter((r) => r.stage === "offer").length) },
      { label: "enrolled", value: String(enrollments.filter((r) => r.stage === "enrolled").length), tone: "success" },
    ],
    columns: ["FAMILY / CHILD", "ROOM", "STAGE", "DESIRED START", "SOURCE"],
    rows: enrollments.map((row) => [
      `${row.guardian_name ?? "Family"} · ${[row.child_first_name, row.child_last_name].filter(Boolean).join(" ") || "Child pending"}`,
      row.classroom?.name ?? "—",
      row.stage,
      row.desired_start_date ?? "—",
      row.source ?? "—",
    ]),
    rowCount: enrollments.length,
  };
}
