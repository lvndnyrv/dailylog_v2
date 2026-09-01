export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9-]{36}$/i.test(id))
    return new Response("Document unavailable", { status: 404 });
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/compliance-inspection-document`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({ token, documentId: id }),
      cache: "no-store",
    },
  );
  if (!response.ok)
    return new Response(
      "This document is unavailable or the inspection link has expired.",
      { status: 404 },
    );
  return new Response(response.body, {
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") ?? "application/octet-stream",
      "Content-Disposition":
        response.headers.get("Content-Disposition") ?? "inline",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
