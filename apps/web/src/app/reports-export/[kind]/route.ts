import {
  getMyProfile,
  listAttendanceDay,
  listInvoices,
  listRoster,
} from "@dailylog/db/queries";
import { isAdminRole } from "@dailylog/shared";
import { getServerSupabase } from "@/lib/supabase/server";

// CSV exports behind the Reports library (13a/13b). Admin-only; RLS scopes
// every row to the caller's center.

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
  if (!isAdminRole(profile?.role)) {
    return new Response("Admins only", { status: 403 });
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
        invoice.billed_to_profile?.full_name ?? "",
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
