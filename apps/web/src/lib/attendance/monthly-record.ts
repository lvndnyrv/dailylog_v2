import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@dailylog/db";

type Client = SupabaseClient<Database>;

export interface MonthlyAttendanceRow {
  id: string;
  date: string;
  status: string;
  absenceReason: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  droppedOffBy: string | null;
  pickedUpBy: string | null;
  corrections: Array<{
    reason: string;
    correctedAt: string;
    correctedBy: string | null;
  }>;
}

export interface MonthlyChildRecord {
  id: string;
  name: string;
  room: string;
  rows: MonthlyAttendanceRow[];
  attendedDays: number;
  absentDays: number;
  completedHours: number;
  averageHours: number | null;
  incompleteDays: number;
  absenceReasons: Record<string, number>;
}

type DbRow = {
  id: string;
  date: string;
  status: string;
  absence_reason: string | null;
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

export function nextAttendanceMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return number === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(number + 1).padStart(2, "0")}-01`;
}

export function attendanceIntervalHours(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const hours = (Date.parse(end) - Date.parse(start)) / 3_600_000;
  return Number.isFinite(hours) && hours >= 0 ? hours : null;
}

export async function loadMonthlyAttendanceRecords(
  client: Client,
  month: string,
  childId?: string,
): Promise<MonthlyChildRecord[]> {
  const records: DbRow[] = [];
  // PostgREST pages results; do not silently truncate a large center's month.
  for (let offset = 0; ; offset += 500) {
    let query = client
      .from("attendance_records")
      .select(`id, date, status, absence_reason, checked_in_at, checked_out_at,
        dropped_off_by, picked_up_by,
        child:children(id, first_name, last_name, classroom:classrooms(name)),
        corrections:attendance_corrections(reason, corrected_at,
          corrected_by_profile:profiles!attendance_corrections_corrected_by_fkey(full_name))`)
      .gte("date", `${month}-01`)
      .lt("date", nextAttendanceMonth(month))
      .order("date")
      .order("id")
      .range(offset, offset + 499);
    if (childId) query = query.eq("child_id", childId);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as unknown as DbRow[];
    records.push(...page);
    if (page.length < 500) break;
  }

  const grouped = new Map<string, MonthlyChildRecord>();
  if (childId) {
    const { data, error } = await client
      .from("children")
      .select("id, first_name, last_name, classroom:classrooms(name)")
      .eq("id", childId)
      .maybeSingle();
    if (error) throw error;
    if (data) grouped.set(data.id, {
      id: data.id,
      name: `${data.first_name} ${data.last_name}`,
      room: data.classroom?.name ?? "Unassigned",
      rows: [], attendedDays: 0, absentDays: 0, completedHours: 0,
      averageHours: null, incompleteDays: 0, absenceReasons: {},
    });
  }
  for (const record of records) {
    if (!record.child) continue;
    const child = record.child;
    let summary = grouped.get(child.id);
    if (!summary) {
      summary = {
        id: child.id,
        name: `${child.first_name} ${child.last_name}`,
        room: child.classroom?.name ?? "Unassigned",
        rows: [], attendedDays: 0, absentDays: 0, completedHours: 0,
        averageHours: null, incompleteDays: 0, absenceReasons: {},
      };
      grouped.set(child.id, summary);
    }
    const hours = attendanceIntervalHours(record.checked_in_at, record.checked_out_at);
    if (record.checked_in_at) {
      summary.attendedDays += 1;
      if (hours === null) summary.incompleteDays += 1;
      else summary.completedHours += hours;
    } else if (record.status === "absent" || record.status === "excused") {
      summary.absentDays += 1;
      const reason = record.absence_reason?.trim() ||
        (record.status === "excused" ? "Excused" : "Unspecified");
      summary.absenceReasons[reason] = (summary.absenceReasons[reason] ?? 0) + 1;
    }
    summary.rows.push({
      id: record.id,
      date: record.date,
      status: record.status,
      absenceReason: record.absence_reason,
      checkedInAt: record.checked_in_at,
      checkedOutAt: record.checked_out_at,
      droppedOffBy: record.dropped_off_by,
      pickedUpBy: record.picked_up_by,
      corrections: (record.corrections ?? []).map((correction) => ({
        reason: correction.reason,
        correctedAt: correction.corrected_at,
        correctedBy: correction.corrected_by_profile?.full_name ?? null,
      })),
    });
  }
  return Array.from(grouped.values())
    .map((record) => {
      const complete = record.attendedDays - record.incompleteDays;
      return {
        ...record,
        averageHours: complete ? record.completedHours / complete : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
