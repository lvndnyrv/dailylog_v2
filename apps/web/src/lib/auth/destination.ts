// Auth links may carry an in-app destination, never an external redirect.
export function safeInternalDestination(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")
      || /[\\\u0000-\u001f]/.test(value)) return fallback;
  try {
    const base = "https://dailylog.invalid";
    const destination = new URL(value, base);
    if (destination.origin !== base) return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}
