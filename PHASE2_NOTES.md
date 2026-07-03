# Phase 2 Implementation Notes — Security Hardening — July 3, 2026

Phase 2 from `AUDIT_REPORT.md` §7 is implemented. Fixes audit finding **4.3**
(storage over-exposure, incident write scoping, column-level privilege
escalation, multi-classroom RLS mismatch). One manual step: **run the
migration** (see below).

---

## ✅ What was implemented

### Server — `supabase-phase2-security.sql` (new migration)

| Fix | Detail |
|---|---|
| **A. Storage scoping** | All three buckets (`child-avatars`, `incident-photos`, `daily-log-photos`) now gate SELECT/INSERT/UPDATE/DELETE on `can_access_child(first path segment)` — an educator of the child's daycare or a linked parent. "Any authenticated user can view child photos" is gone. Malformed paths (non-UUID first segment) are denied via a safe-cast helper `storage_child_id()`. |
| **B. Incident INSERT scoping** | Educators can only file incidents for children **in their own daycare**, and must set `educator_id = auth.uid()`. Educator incident SELECT also broadened single-classroom → daycare (matches multi-classroom model). |
| **C. Column-safe acknowledgment** | Parents have **zero UPDATE** on `incident_reports` (they could previously rewrite the description). New security-definer RPC `acknowledge_incident(p_incident_id, p_full_name)` validates the parent↔child link, requires a non-empty name, and only flips `status/parent_acknowledged_at/parent_acknowledge_name` on `status='submitted'` rows — idempotent, so offline replays are safe. |
| **D. Multi-classroom fix** | `can_access_log()` (gates all entry tables + `photos`) redefined: educator access is daycare-wide instead of pinned to the single "active" `profiles.classroom_id`. Switching rooms no longer locks an educator out of the other room's logs. |
| **E. Column-level grants** | RLS rows policies can't restrict columns, so: `profiles` UPDATE limited to `(full_name, phone, daycare_id, classroom_id)` — no more parent→admin self-promotion via `role`; `parent_children` UPDATE limited to `(consent_given_at)` — no more rebinding `child_id` to an arbitrary child; `messages` UPDATE limited to `(read_at)` — no more editing sent message bodies. |

### Client — aligned with the new rules

| File | Change |
|---|---|
| `src/lib/offlineQueue.js` | New `{ type: 'rpc', fn, args }` op in `execute()` — RPCs ride the same offline-first `mutate()` path (queue on network failure, replay on flush). |
| `src/hooks/useIncidentReport.js` | `acknowledgeReport()` now calls the `acknowledge_incident` RPC via `mutate()` instead of a direct `UPDATE` (which parents can no longer do). Keeps optimistic local merge + `queued` passthrough. |
| `src/screens/parent/IncidentDetailScreen.js` | Acknowledge handler distinguishes `queued` (offline) → honest "Saved — will sync" message instead of a false "Acknowledged ✓". |
| `src/screens/educator/ManageScreen.js` | Parent-link upsert now `ignoreDuplicates: true` (`ON CONFLICT DO NOTHING`). The old `DO UPDATE` form needs UPDATE grants on `parent_id`/`child_id`, which E2 revoked — the link would have started failing. |
| `src/screens/educator/ChildProfileScreen.js` | Same `ignoreDuplicates` fix for the invite-parent link path. |

### Verified already-compliant (no change needed)
- **Storage paths** all follow the `{childId}/...` convention the policies key on: avatars `{childId}/avatar_*.jpg`, incident photos `{childId}/{incidentId}/*.jpg`, daily-log photos `{childId}/{logId}/*.jpg` (convention introduced in Phase 0 — existing objects conform).
- **Incident INSERT** already sends `educator_id: profile.id` (`IncidentReportScreen.createDraft`).
- **`profiles` updates** only touch granted columns: EditProfile (`full_name, phone`), Onboarding (`daycare_id, classroom_id`), classroom switcher (`classroom_id`); `useAuth` upserts are `DO NOTHING`.
- **`parent_children`**: ConsentScreen updates only `consent_given_at`; `useAuth` pending-link upsert already `ignoreDuplicates`.
- **`messages`**: client only INSERTs (read_at marking lands with the Phase 3 inbox).
- **Educator incident draft editing** keeps working — the educator UPDATE policy survives; only the parent policy was dropped.

---

## 🔧 Manual steps required

### 1. Run the migration
Supabase Dashboard → SQL Editor → paste & run **`supabase-phase2-security.sql`**.
Idempotent (safe to re-run). Must run **after** `supabase-phase0-reconciliation.sql`.

No native rebuild needed — client changes are pure JS.

---

## 🧪 Acceptance test checklist

Cross-tenant isolation (the roadmap's acceptance bar: *a second test daycare can read nothing from the pilot daycare*):
- [ ] Educator in Daycare B: signed-URL fetch of a Daycare A child avatar / incident photo / daily-log photo → **403**
- [ ] Educator in Daycare B: `insert into incident_reports` for a Daycare A child → RLS rejection
- [ ] Educator in Daycare B cannot see Daycare A incidents/logs in any list

Column safety:
- [ ] Parent: direct `update incident_reports set description=…` (e.g. via REST) → **permission denied**
- [ ] Parent acknowledges via app → status flips, name + timestamp recorded, educator sees ✅
- [ ] Acknowledge in airplane mode → "Saved — will sync" → reconnect → row acknowledged exactly once
- [ ] Parent: `update profiles set role='admin'` → **permission denied**; editing own name/phone still works
- [ ] Parent: `update parent_children set child_id=<other kid>` → **permission denied**; consent flow still works
- [ ] Any user: `update messages set body=…` → **permission denied**

Multi-classroom regression:
- [ ] Educator with 2 rooms: switch active room → yesterday's logs and photos from the *other* room still open fine
- [ ] Invite flow: linking an already-registered parent twice shows "Linked ✓" both times (no permission error)

## ⏭️ Next up (per roadmap)
Phase 3 — Educator & parent UX: educator inbox + `read_at` (the grant is already in place) + message push; native pickers; safe-area overhaul; nap timer; weekly child switcher; roster quick-actions; accessibility.

