# Phase 1 Implementation Notes — Offline & Reliability — July 3, 2026

Phase 1 from `AUDIT_REPORT.md` §7 is implemented. No manual steps required —
this phase is pure JS (no native or DB changes). Fixes audit findings **4.1**
(misleading offline promise) and part of **§16** (silent error swallowing).

---

## ✅ What was implemented

### New infrastructure
| File | Purpose |
|---|---|
| `src/lib/uuid.js` | Client-side UUID v4 — every offline insert carries its own primary key so replays are idempotent |
| `src/components/Toast.js` | Global toast system: `<ToastHost />` (mounted in App.js) + `showToast()` / `toastError()` callable from anywhere |

### `src/lib/offlineQueue.js` — upgraded
- **`mutate(op)`** — the one write path for the app: executes immediately when online; enqueues when offline or when the request throws (network drop mid-flight). Returns `{ data, error, queued }` — `error` means a real RLS/validation rejection (caller rolls back optimistic state), `queued` means "saved locally, will sync".
- **Idempotent replay** — inserts run as `upsert … ON CONFLICT (id) DO NOTHING`, so an op that reached the server before the connection dropped doesn't duplicate on flush.
- **Live queue events** — `subscribeQueue()` powers real-time pending counts in the banner.
- **Retry cap** — server-rejected ops are retried 3× then dropped (logged); network failures retry forever.

### `useDailyLog` — optimistic + offline-first (the big one)
- Every mutation (meals, diapers, naps, activities, supplies, moods, notes) now **updates the UI instantly**, then syncs through `mutate()`. Hard failures roll back + toast. No more "tap Add and nothing happens" on flaky Wi-Fi.
- **Realtime dedupe** — INSERT events upsert-by-id, so the optimistic row and its realtime echo never duplicate; lists stay time-sorted.
- **Offline log creation** — opening a child with no log while offline creates a local log row (client UUID) and queues it; subsequent entries queue behind it in order.
- Log creation now conflicts on `(child_id, log_date)` so replays merge with a log another educator created meanwhile.
- **Send to parents requires connectivity** (the push must go out with it) — offline attempts get an honest explanation instead of a fake "Sent ✓".

### Messaging (`MessagingScreen`)
- Optimistic append with client UUID → **messages send offline** and sync later.
- Roll-back + draft restore + toast on hard failure; realtime dedupe by id.

### Incidents (`useIncidentReport`, `IncidentReportScreen`)
- **Drafts can be created offline** (client UUID) — critical for playground incidents.
- All updates/submit run through `mutate()`.
- **Photo upload failure no longer blocks the report** — educator is offered "Submit without photos".
- Offline submit shows "saved — will submit when online" and skips the (impossible) push, telling the educator to notify parents in person.

### Network status & banner
- `useNetworkStatus`: live pending count (queue subscription), **flush on reconnect** with "✓ Synced N offline changes" toast, **startup flush** of leftovers from a killed session, fixed `isInternetReachable: null` being treated as offline.
- `OfflineBanner`: amber "offline (N pending)" state **plus** a purple "Syncing N pending changes…" state when online with a backlog. The banner's promise is now true.

### BulkLog
- Honest offline guard (bulk apply needs server read-back of log ids) — points educators to per-child logging, which *does* work offline.

---

## 🧪 Acceptance test checklist

- [ ] Airplane mode → open a child from roster → add meals/naps/moods/notes → everything appears instantly, banner shows pending count climbing
- [ ] Reconnect → "✓ Synced N offline changes" toast → rows exist in Supabase, **no duplicates**
- [ ] Airplane mode → send a chat message → appears in thread; reconnect → arrives in DB once
- [ ] Airplane mode → complete incident wizard → "will submit when online" message; reconnect → report submitted
- [ ] Kill app with pending queue → reopen online → startup flush syncs + toasts
- [ ] Online: add meal → appears instantly (not after realtime round-trip)
- [ ] Force an RLS error (e.g. parent role adding a meal) → row disappears (rollback) + error toast, nothing silently lost
- [ ] "Send to parents" in airplane mode → clear offline explanation, log NOT marked sent

## ⚠️ Known limitations (deliberate scope)
- **Photo uploads don't queue** (binary payloads) — they fail fast with a clear path forward (incidents: submit without photos; daily-log photos: alert).
- **Queued entries behind an offline-created log** can be dropped in one rare edge: another educator created the same child+day log while you were offline (FK points at your local log id). Logged, capped at 3 retries.
- Offline changes are device-local (AsyncStorage) — no cross-device merge until sync.

## ⏭️ Next up (per roadmap)
Phase 2 — Security hardening: storage read scoping by daycare/linkage, classroom check on incident INSERT, column-safe `acknowledge_incident` RPC, educator policies on `educator_classrooms` membership.

