import {
  getMyProfile,
  hasPermission,
  listAttendanceDay,
  listInvoices,
  listRoster,
} from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { getServerSupabase } from "@/lib/supabase/server";

// CSV exports behind the Reports library (13a/13b). Admin-only; RLS scopes
// every row to the caller's center.

function nextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!isAdminRole(profile?.role) || !(await hasPermission(supabase, "reports", "view"))) {
    return new Response("Reports permission required", { status: 403 });
  }

  const url = new URL(request.url);
  let rows: string[][];
  let name: string;

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
  } else if (kind === "attendance-month") {
    // 8e monthly attendance record — one row per child per attended day
    const month =
      url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const { data, error } = await supabase
      .from("attendance_records")
      .select(
        `date, status, checked_in_at, checked_out_at, dropped_off_by, picked_up_by,
         child:children(first_name, last_name, classroom:classrooms(name))`,
      )
      .gte("date", `${month}-01`)
      .lt("date", nextMonth(month))
      .order("date");
    if (error) return new Response(error.message, { status: 500 });

    type Row = {
      date: string;
      status: string;
      checked_in_at: string | null;
      checked_out_at: string | null;
      dropped_off_by: string | null;
      picked_up_by: string | null;
      child: {
        first_name: string;
        last_name: string;
        classroom: { name: string } | null;
      } | null;
    };
    rows = [
      ["Date", "Child", "Room", "Status", "In", "Out", "Dropped off by", "Picked up by"],
      ...((data ?? []) as unknown as Row[]).map((record) => [
        record.date,
        record.child ? `${record.child.first_name} ${record.child.last_name}` : "",
        record.child?.classroom?.name ?? "",
        record.status,
        record.checked_in_at ?? "",
        record.checked_out_at ?? "",
        record.dropped_off_by ?? "",
        record.picked_up_by ?? "",
      ]),
    ];
    name = `attendance-${month}.csv`;
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
  } else if (kind === "invoices") {
    const invoices = await listInvoices(supabase);
    rows = [
      ["Number", "Family", "Child", "Status", "Issued", "Due", "Total"],
      ...invoices.map((invoice) => [
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
  } else {
    return new Response("Unknown report", { status: 404 });
  }

  return new Response(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
