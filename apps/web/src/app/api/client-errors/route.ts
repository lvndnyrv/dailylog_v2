import { NextResponse } from "next/server";

import { getServerSupabase } from "@/lib/supabase/server";

function safeReference(value: unknown): string | null {
  const cleaned = String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return cleaned || null;
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ accepted: false }, 401);

  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return json({ accepted: false }, 400);
  }

  const errorCode = String(payload.errorCode ?? "").toLowerCase();
  if (!/^[a-z0-9_]{3,64}$/.test(errorCode)) {
    return json({ accepted: false }, 400);
  }

  const { data, error } = await supabase.rpc("report_client_error" as never, {
    p_surface: "web_admin",
    p_error_code: errorCode,
    p_app_version: process.env.NEXT_PUBLIC_APP_VERSION?.slice(0, 32) || null,
    p_release_channel: process.env.VERCEL_ENV?.slice(0, 32) || process.env.NODE_ENV,
    p_framework_reference: safeReference(payload.frameworkReference),
  } as never);

  if (error || !data) return json({ accepted: false }, 202);
  return json({ accepted: true, reference: String(data).slice(0, 8).toUpperCase() }, 200);
}
