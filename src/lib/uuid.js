/**
 * Client-side UUID v4 generator.
 * Used so offline-queued inserts carry their own primary key and can be
 * replayed idempotently (upsert ON CONFLICT (id) DO NOTHING).
 * Math.random is fine here — these are idempotency keys, not secrets.
 */
export function newId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

