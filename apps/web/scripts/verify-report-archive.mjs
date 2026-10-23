import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to verify report archives.");
  process.exit(2);
}

const client = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let cursor = "";
let checked = 0;
let failed = 0;

while (true) {
  let query = client.from("report_exports")
    .select("id,daycare_id,format,storage_path,content_bytes,content_sha256")
    .not("storage_path", "is", null)
    .order("id", { ascending: true })
    .limit(100);
  if (cursor) query = query.gt("id", cursor);
  const { data: exports, error } = await query;
  if (error) throw error;
  if (!exports?.length) break;

  for (const item of exports) {
    checked += 1;
    const expectedPath = `${item.daycare_id}/${item.id}.${item.format}`;
    if (item.storage_path !== expectedPath || !item.content_sha256
      || !Number.isSafeInteger(item.content_bytes) || item.content_bytes < 0) {
      console.error(`Invalid archive metadata: ${item.id}`);
      failed += 1;
      continue;
    }
    const { data: file, error: downloadError } = await client.storage
      .from("report-exports").download(expectedPath);
    if (downloadError || !file) {
      console.error(`Archive unavailable: ${item.id}`);
      failed += 1;
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== item.content_bytes || digest !== item.content_sha256) {
      console.error(`Archive integrity mismatch: ${item.id}`);
      failed += 1;
    }
  }
  cursor = exports.at(-1).id;
  if (exports.length < 100) break;
}

console.log(`Verified ${checked} report archive files; ${failed} failed.`);
if (failed) process.exitCode = 1;
