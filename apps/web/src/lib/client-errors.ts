export async function reportWebClientError(
  errorCode: string,
  frameworkReference?: string,
): Promise<string | null> {
  try {
    const response = await fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ errorCode, frameworkReference }),
      keepalive: true,
    });
    const result = await response.json() as { accepted?: boolean; reference?: string };
    return result.accepted && result.reference ? result.reference : null;
  } catch {
    return null;
  }
}
