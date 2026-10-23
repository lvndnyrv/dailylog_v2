import { NextResponse } from "next/server";
import { safeInternalDestination } from "@/lib/auth/destination";
import { getServerSupabase } from "@/lib/supabase/server";

// Supabase SSR uses PKCE. Email sign-in and recovery links return here with a
// short-lived authorization code, which must be exchanged before protected
// server components can see the user's cookie-backed session.
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const destination = safeInternalDestination(requestUrl.searchParams.get("next"), "/");

  if (code) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(destination, requestUrl.origin));
  }

  const signIn = new URL("/sign-in", requestUrl.origin);
  signIn.searchParams.set("link", "expired");
  return NextResponse.redirect(signIn);
}
