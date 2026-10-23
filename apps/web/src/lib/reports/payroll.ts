export type PayrollPreviewEntry = {
  staff_member_id: string;
  clocked_in_at: string;
  clocked_out_at: string | null;
  break_minutes: number;
  status: string;
  staff: { profile: { full_name: string } | null } | null;
};

export function isValidPayrollDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Keep a staff member's entries together even when another member has the same name. */
export function summarizePayrollEntries(entries: PayrollPreviewEntry[]) {
  const byStaff = new Map<string, { name: string; minutes: number; entries: number; approved: boolean }>();
  for (const entry of entries) {
    const current = byStaff.get(entry.staff_member_id) ?? {
      name: entry.staff?.profile?.full_name ?? "Unlinked staff",
      minutes: 0,
      entries: 0,
      approved: true,
    };
    const duration = entry.clocked_out_at
      ? Math.max(0, Math.round((Date.parse(entry.clocked_out_at) - Date.parse(entry.clocked_in_at)) / 60000) - entry.break_minutes)
      : 0;
    current.minutes += duration;
    current.entries += 1;
    current.approved = current.approved && entry.status === "approved" && !!entry.clocked_out_at;
    byStaff.set(entry.staff_member_id, current);
  }
  return byStaff;
}
