import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions, SESSION_ONLY_COOKIE } from "@/lib/auth/session-cookie";

// Next 16 proxy (né middleware): refreshes the Supabase session cookie on
// every matched request and keeps signed-out users out of the console.
// Fine-grained role checks live in the pages/layouts, not here.

const PUBLIC_PATHS = [
  "/sign-in",
  "/forgot",
  "/reset",
  "/invite",
  "/start",
  "/signed-out",
  "/sign-out-error",
  "/inquire",
  "/inspection",
  "/privacy",
  "/account-deletion",
  "/sign-out-error",
  "/support",
  "/auth/callback",
  "/internal/report-delivery",
];

const SENSITIVE_PUBLIC_PATHS = [
  "/sign-in",
  "/forgot",
  "/reset",
  "/invite",
  "/start",
  "/inquire",
  "/inspection",
  "/account-deletion",
  "/auth/callback",
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;
  const sessionOnly = request.cookies.get(SESSION_ONLY_COOKIE)?.value === "1";

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, authCookieOptions(options, sessionOnly));
        }
      },
    },
  });

  // Do not run other logic between client creation and getUser() — the token
  // refresh this triggers is the whole point of the proxy.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isSensitivePublic = SENSITIVE_PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic && pathname !== "/") {
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/sign-in";
    signIn.search = "";
    signIn.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signIn);
  }

  if (user && pathname === "/sign-in") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  if (user || !isPublic || isSensitivePublic) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.append("Vary", "Cookie");
  }

  return response;
}

export const config = {
  // Everything except static assets and images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
