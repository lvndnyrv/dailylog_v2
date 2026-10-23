import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@dailylog/db";
import type { ReportKind } from "./catalog";
import { REPORT_CATALOG } from "./catalog";

const MAX_ARCHIVE_BYTES = 52_428_800;

export class ReportArchiveTooLargeError extends Error {}

export async function archiveReport(
  client: SupabaseClient<Database>,
  input: {
    daycareId: string;
    profileId: string | null;
    kind: ReportKind;
    format: "csv" | "pdf";
    startsOn: string | null;
    endsOn: string | null;
    rowCount: number;
    parameters: Record<string, string | boolean>;
    bytes: Uint8Array;
  },
): Promise<string> {
  if (input.bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ReportArchiveTooLargeError("Report exceeds the 50 MB archive limit; choose a shorter period");
  }
  const id = randomUUID();
  const storagePath = `${input.daycareId}/${id}.${input.format}`;
  const { error: uploadError } = await client.storage.from("report-exports").upload(
    storagePath,
    input.bytes,
    { contentType: input.format === "pdf" ? "application/pdf" : "text/csv", upsert: false },
  );
  if (uploadError) throw uploadError;

  const { error: insertError } = await client.from("report_exports").insert({
    id,
    daycare_id: input.daycareId,
    created_by: input.profileId,
    report_kind: input.kind,
    title: REPORT_CATALOG[input.kind].title,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    format: input.format,
    row_count: input.rowCount,
    parameters: input.parameters,
    storage_path: storagePath,
    content_sha256: createHash("sha256").update(input.bytes).digest("hex"),
    content_bytes: input.bytes.byteLength,
  });
  if (insertError) {
    // The delete policy permits cleanup only while no metadata row references
    // this object. A completed export cannot be removed by the application.
    await client.storage.from("report-exports").remove([storagePath]);
    throw insertError;
  }
  return id;
}
