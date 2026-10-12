import { getServerSupabase } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const client = await getServerSupabase();
  const { data: allowed, error: accessError } = await client.rpc("can_access_compliance");
  if (accessError || !allowed) {
    return new Response("Document not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const { data: document, error } = await client
    .from("compliance_documents")
    .select("storage_path")
    .eq("id", id)
    .single();
  if (error || !document)
    return new Response("Document not found", { status: 404 });
  const { data, error: signError } = await client.storage
    .from("compliance-vault")
    .createSignedUrl(document.storage_path, 60);
  if (signError || !data)
    return new Response("Document unavailable", { status: 404 });
  return new Response(null, {
    status: 302,
    headers: {
      Location: data.signedUrl,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
