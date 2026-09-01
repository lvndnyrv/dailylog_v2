import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Validate the bearer share on every download. Never accept a client-provided
// bucket or storage path, and never return a reusable Storage signed URL.
Deno.serve(async (request) => {
  const headers = {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers });
  try {
    const { token, documentId } = (await request.json()) as {
      token?: unknown;
      documentId?: unknown;
    };
    if (
      typeof token !== "string" ||
      !/^[a-f0-9]{64}$/.test(token) ||
      typeof documentId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(documentId)
    )
      return new Response("Document unavailable", { status: 404, headers });
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: document, error } = await client.rpc(
      "read_compliance_inspection_share",
      { p_token: token, p_document_id: documentId },
    );
    if (error || !document)
      return new Response("Document unavailable", { status: 404, headers });
    const { data: file, error: fileError } = await client.storage
      .from("compliance-vault")
      .download(document.storage_path);
    if (fileError || !file)
      return new Response("Document unavailable", { status: 404, headers });
    const name =
      String(document.title)
        .replace(/[^a-zA-Z0-9 _.-]/g, "")
        .slice(0, 120) || "document";
    return new Response(file, {
      headers: {
        ...headers,
        "Content-Type": document.mime_type,
        "Content-Disposition": `inline; filename="${name}"`,
      },
    });
  } catch {
    return new Response("Document unavailable", { status: 404, headers });
  }
});
