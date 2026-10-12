import { headers } from "next/headers";

function validHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function localDevelopmentOrigin(value: string | null): string | null {
  if (!value || process.env.NODE_ENV === "production") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)
    ) {
      return parsed.origin;
    }
  } catch {
    // An invalid request origin is rejected below.
  }
  return null;
}

/**
 * Returns an origin that is safe to embed in emailed authentication links.
 * Production never trusts Host or Origin request headers; deployments must use
 * an explicit canonical URL or a platform-provided Vercel URL.
 */
export async function trustedRequestOrigin(): Promise<string> {
  const configured = validHttpsOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (configured) return configured;

  const vercel = validHttpsOrigin(
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL,
  );
  if (vercel) return vercel;

  const requestHeaders = await headers();
  return localDevelopmentOrigin(requestHeaders.get("origin"))
    ?? localDevelopmentOrigin(
      requestHeaders.get("host") ? `http://${requestHeaders.get("host")}` : null,
    )
    ?? "";
}
