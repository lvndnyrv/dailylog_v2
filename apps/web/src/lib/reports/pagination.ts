const PAGE_SIZE = 500;

type PageResponse<T> = { data: T[] | null; error: unknown };

/** Fetch every top-level row instead of silently accepting PostgREST's row cap. */
export async function fetchAllReportRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResponse<T>>,
): Promise<PageResponse<T>> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await page(offset, offset + PAGE_SIZE - 1);
    if (result.error) return { data: null, error: result.error };
    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { data: rows, error: null };
  }
}
