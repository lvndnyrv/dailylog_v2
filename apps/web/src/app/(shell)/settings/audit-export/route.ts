import { getServerSupabase } from "@/lib/supabase/server";

function csv(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET() {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("audit_log")
    .select("created_at,action,entity_type,entity_id,actor:profiles(full_name,email)")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return new Response(error.message, { status: 500 });

  const rows = ["timestamp,actor,email,action,record_type,record_id"];
  for (const entry of data ?? []) {
    const actor = entry.actor as unknown as { full_name: string; email: string } | null;
    rows.push([
      entry.created_at,
      actor?.full_name ?? "System",
      actor?.email ?? "",
      entry.action,
      entry.entity_type,
      entry.entity_id ?? "",
    ].map(csv).join(","));
  }
  await supabase.rpc("record_audit_log_export", { p_row_count: data?.length ?? 0 });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(`${rows.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dailylog-audit-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
