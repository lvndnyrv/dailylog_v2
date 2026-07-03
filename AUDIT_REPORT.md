# DailyLog — Full Repository Audit & Improvement Report

**Date:** July 3, 2026 · **Scope:** entire repo (app code, SQL, config) · **Stack:** Expo SDK 54 / React Native 0.81 / React 19 / Supabase (Postgres + RLS + Realtime + Storage) / React Navigation 7

---

## 1. What this app is

DailyLog is a two-sided daycare communication app piloted for "Smart Kid South Newmarket":

- **Educators** manage classrooms and rosters, fill per-child daily logs (moods, meals, diapers/toilet, naps, activities, supply requests, notes, photos), bulk-log across children, report injuries/incidents with a 3-step wizard, invite/link parents, and message parents per child.
- **Parents** see a live view of their child's day, weekly analytics, incident alerts requiring signed acknowledgment, and chat with educators.
- **Foundation:** Supabase auth + role-based profiles (`educator` / `parent` / `admin`), RLS-secured tables, realtime subscriptions for live updates, a small offline queue, and Expo push notifications (intended).

The product concept is strong and the UI layer is unusually polished for an MVP (consistent theme tokens, empty states, filter/search on roster, step wizards). The main problems live **below** the UI: schema drift, dead notification plumbing, silent-failure data access, and misleading offline/delete semantics.

---

## 2. Scorecard

| Area | Grade | One-liner |
|---|---|---|
| UI design system & visual polish | **A–** | Cohesive theme, reusable `ui.js` primitives, good empty/loading states |
| Information architecture / navigation | **B+** | Sensible role-based tabs + stacks; a few dead ends (educator inbox, past dates) |
| Data model (SQL) | **B–** | Good normalized core; but repo SQL is out of sync with the code |
| Security (RLS/storage) | **C** | Solid read scoping; missing write policies, over-broad storage reads, column-level gaps |
| Reliability & error handling | **D+** | Errors ignored almost everywhere; realtime-only UI updates; race conditions |
| Notifications | **F (non-functional)** | Tokens are never registered — no push is ever delivered |
| Offline support | **D** | Banner over-promises; only incident updates actually queue |
| Feature completeness vs. market | **C+** | Core logging is competitive; attendance/medical/admin/export missing |
| Code health (tests/types/CI) | **D** | No tests, no TS/ESLint, no CI, hardcoded credentials in source |

---

## 3. Critical defects (broken today)

### 3.1 Push notifications are dead code 🔴
`src/hooks/usePushNotifications.js` only sets a notification *handler*. It never requests permission, never calls `getExpoPushTokenAsync`, and **never writes to the `push_tokens` table** (created in `supabase-week3.sql`). Consequently `get_parent_push_tokens()` always returns zero rows, so `notifyParents()` and `notifyIncident()` silently no-op. The "Submit & Notify Parents" incident flow tells the educator that parents were notified — **they were not**. Also: `app.json → extra.eas` has no `projectId` (required for token fetch), and the `urgent` Android channel referenced for serious incidents is never created.

### 3.2 Schema drift — code references DB objects that exist in no SQL file 🔴
| Referenced in code | Where | Missing from repo SQL |
|---|---|---|
| `messages` table | `MessagingScreen.js`, `ParentMessagesScreen.js` | table + RLS + realtime publication |
| `photos` table + `daily-log-photos` bucket | `PhotoSection.js` | table + RLS + bucket + policies |
| `educator_classrooms` junction | `useClassroom.js` (multi-classroom core) | table + RLS |
| `profiles.phone` column | `useAuth.signUp`, `EditProfileScreen`, `ManageScreen`, `DailyLogScreen` call-parent | column |

If the live database has these, they were created ad-hoc and the repo can't rebuild the environment. If it doesn't, four features are broken.

### 3.3 Missing RLS INSERT policies block core flows 🔴
`supabase-schema.sql` enables RLS on everything but defines **no INSERT policy** for `profiles`, `daycares`, `classrooms`, `children`, or `parent_children`. As written, signup profile creation, the entire educator onboarding wizard, "Add child", and "Invite parent" linking are all RLS-blocked. (`children` also lacks UPDATE — so editing a child profile, photos, moving classrooms and soft-archiving are blocked too.)

### 3.4 Past-date logs can't be opened 🔴
`RosterScreen` has date navigation and shows per-day status for any past day, but tapping a child navigates without the date — `DailyLogScreen` calls `useDailyLog(child.id)` which hardcodes **today**. Educators cannot view or complete yesterday's log even though the roster implies they can.

### 3.5 "Remove child" destroys history while claiming otherwise 🔴
Both `ManageScreen.removeChild` and `ChildProfileScreen.handleRemove` say *"Their log history will be kept"*, but `children.id` cascades (`on delete cascade`) through `daily_logs` → all entries, plus `parent_children` and `incident_reports`. **Everything is permanently destroyed.** This needs soft-delete (`archived_at`) — it's also a compliance issue since incident records often have statutory retention requirements.

### 3.6 Parent invitations produce broken accounts 🔴
`InviteParentForm` / `ChildProfileScreen` use `signInWithOtp` magic links, but: the Supabase client sets `detectSessionInUrl: false`, no app `scheme`/deep-link handling exists, profile rows are only created in the *password* signup path, and the `pending_child_id` metadata is never processed. An invited parent who taps the email link ends up authenticated with **no profile row** → `RootNavigator` renders ParentTabs → `ParentHomeScreen` waits on `profile` forever → infinite spinner.

### 3.7 Account deletion & password recovery gaps 🔴
`delete_my_account()` deletes the `profiles` row but **not `auth.users`** — deleted users can log back in and land in the same broken null-profile state as 3.6. There is **no forgot-password flow** anywhere in the app.

### 3.8 `useDailyLog.getOrCreateLog` correctness 🟠
- Parents also run the get-or-**create** path — every parent view fires a doomed INSERT (RLS-blocked, error ignored).
- Educator inserts omit `educator_id`, so logs are never attributed to a teacher (bad for accountability and incident audits).
- Two educators opening the same child concurrently race on `unique(child_id, log_date)`; the loser's insert fails silently and the screen sits on a null log. Should be a scoped upsert with error surfacing.

---

## 4. High-impact issues

### 4.1 Offline promise is misleading
`OfflineBanner` says *"changes will sync when you reconnect"*, but only `useIncidentReport.updateReport` uses `offlineQueue`. Every daily-log write (meals, diapers, naps, moods, notes, photos, messages) fails silently offline. Compounding it, entry lists update **only via realtime events** — even online, on a flaky connection an educator taps "+ Add meal" and sees nothing appear. Daycares are notorious for weak Wi-Fi in some rooms; this is the #1 reliability complaint you'd get in a pilot.

### 4.2 Educators have no message inbox
Parents get `ParentMessagesScreen` with unread badges. Educators can only discover a parent's message by opening that specific child's chat from `DailyLogScreen`. With 15–20 kids, incoming parent messages are effectively invisible (and there are no message push notifications). Unread counts are also inferred with 3 queries per thread instead of a `read_at` marker.

### 4.3 Security holes
- **Storage:** `child-avatars` and `incident-photos` SELECT policies allow **any authenticated user** (any daycare, any role) to view objects. Child photos deserve strict scoping.
- **Incidents:** INSERT policy only checks `role = 'educator'` — any educator can file incidents for any child in any daycare. Parent UPDATE policy doesn't restrict columns — a parent can modify the incident *description*, not just acknowledgment fields.
- **Multi-classroom mismatch:** RLS scopes educators via single `profiles.classroom_id`, but the app's `educator_classrooms` model means an educator "in" Room 2 loses access to Room 1 data mid-switch; policies should check junction membership.
- **Secrets:** Supabase URL/anon key hardcoded in `src/lib/supabase.js` (anon key is public by design, but env-based config is still the right hygiene, especially with `eas.json` committed).

### 4.4 Performance (N+1 everywhere on hot paths)
- `RosterScreen.load()` runs **3 count queries per child** on every focus/date change (a 20-kid room = 60+ queries).
- `BulkLogScreen.handleApply` does sequential per-child select-then-insert round trips.
- `ParentMessagesScreen` runs 3–4 queries per child thread.
- `ChildAvatar` mints a fresh signed URL per mount (roster re-mints all of them per focus). 

Single RPCs/views + a small signed-URL cache fix all four.

### 4.5 Feature gaps vs. Brightwheel/Lillio/Procare class
Missing table-stakes for "one of the best daycare apps": **attendance/check-in-out** (biggest one — you literally can't tell who's present), **allergy/medical/emergency-contact data** on the child profile (safety-critical during incidents), **admin role UI** (role exists in DB, has zero screens), **announcements/broadcasts**, **PDF/CSV export** (licensing bodies ask for daily/incident records), **medication authorization & administration logs**, calendar/events, and staff management.

---

## 5. Component-level notes (what to keep, what to fix)

| Component | Verdict | Notes |
|---|---|---|
| `theme/index.js` + `ui.js` | ✅ Keep | Clean token system; add `Toast`, `ErrorState`, and accessibility props. `Button` should get a `disabled` prop (it only disables while `loading`). |
| `App.js` | 🔧 Refactor | Role-based navigator is right. Replace RN `SafeAreaView` with `react-native-safe-area-context` (Android 15 edge-to-edge on SDK 54+), derive tab-bar height from insets, extract `WeeklySummaryAutoScreen` (inline `require` hack) into its own file with a child switcher. |
| `useAuth` | 🔧 Fix | Move profile creation server-side (auth trigger), add `resetPassword`, handle "profile missing" state explicitly, surface errors. |
| `useClassroom` | 🔧 Fix | Depends on missing `educator_classrooms` table; `switchClassroom` mutating `profiles.classroom_id` as "active room" is clever but RLS must follow (see 4.3). |
| `useDailyLog` | 🔧 Fix | See 3.8; add optimistic updates + offline queueing; accept a `date` param end-to-end. `copyYesterdayLog` is a great UX idea — keep. |
| `offlineQueue` | 🔧 Extend | Sound design (replay + keep-failed); needs client-generated UUIDs for idempotency and adoption by all mutations. |
| `usePushNotifications` | 🚨 Rewrite | See 3.1. Also add notification-response routing (tap → the right screen) and Android channels. |
| `PhotoSection` | 🔧 Fix | Good UX (resize→upload→signed URLs, long-press delete); blocked on missing `photos` table; batch signed URLs; "Hold to delete" hint under every thumb is noisy — move to overflow. |
| `RosterScreen` | 🔧 Fix | Best screen in the app UX-wise; fix N+1 and pass `selectedDate` through navigation. |
| `DailyLogScreen` | 🔧 Polish | Solid section layout; custom wheel `TimePicker` is 5-min granular and laggy vs. the already-installed native `@react-native-community/datetimepicker`; add nap start/stop one-tap timer; handle overnight/negative durations. |
| `BulkLogScreen` | 🔧 Polish | Great differentiator; batch the writes; use active classroom from `useClassroom` (currently reads `profile.classroom_id` directly); consider bulk meals/naps too. |
| `IncidentReportScreen` | ✅ Keep | Best-designed flow in the app (wizard, severity cards, review step, draft persistence). Fix: abandoned drafts are never cleaned up; body-part `Chip` list could be a tap-on-figure later. |
| `ManageScreen` / `ChildProfileScreen` | 🔧 Fix | Feature-rich; fix destructive delete (3.5), OTP invites (3.6), and duplicated invite logic between the two screens (extract a shared hook). |
| `ParentHomeScreen` | ✅ Keep | Live day view + incident banners is exactly right; stop calling the create path (3.8); add attendance status + announcements later. |
| `WeeklySummaryScreen` | ✅ Keep | Genuinely valuable analytics; guard division/`flex: 7 - count` when an activity count exceeds 7 (negative flex crashes). |
| `MessagingScreen` | 🔧 Fix | Clean chat UI; blocked on missing `messages` table; add `read_at`, educator inbox, pagination (currently loads full history), and push on new message. |
| `ConsentScreen` | 🚨 Orphaned | Fully built COPPA/PIPEDA consent flow that is **never imported or navigated to** — `parent_children.consent_given_at` is never populated, while Settings shows "✓ You have consented…" unconditionally. Wire it into the parent's first-open-per-child flow. |
| `SettingsScreen` / `PrivacyScreen` | 🔧 Polish | Fine; privacy policy claims 1-year auto-deletion of logs — **no such job exists**; either implement (pg_cron) or edit the policy. Version string is hardcoded "Smart Kid South Newmarket" — should come from the daycare record. |
| `DatePickerField` | 🔧 Replace | Hand-rolled 3-column scroller; native picker is installed and configured in `app.json` already. |

---

## 6. UX flow recommendations (make it *convenient*)

1. **Educator "morning → evening" loop** is the product. Optimize for: open app → see who's checked in → one-tap common events. Add a **quick-action row on each roster card** (🍽 😴 🩲 with `timeNow()` defaults) so 80% of logging never leaves the roster. The full `DailyLogScreen` becomes the "detail/edit" view.
2. **Nap timer:** "Start nap" → live chip on roster card → "End nap". Educators log naps in real time, not from memory.
3. **Send-day summary:** an end-of-day "Review & send all" screen (per classroom) that lists unsent drafts and sends in one batch — currently each child must be opened and sent individually.
4. **Parent home:** add a compact timeline (time-ordered merged feed of all entry types) — parents think in "what happened since drop-off," not category cards. Keep category cards below.
5. **Incident acknowledgment:** typing a full name is good; also show unacknowledged incidents as a **blocking banner** across all parent tabs, not just Home.
6. **Multi-child parents:** persistent child switcher in the header across all parent tabs (Weekly tab currently locks to the first child).
7. **Educator inbox tab** with unread badges (see 4.2) — swap tab layout to Kids / Bulk / Inbox / Class / Me, or merge Class into Me.
8. **First-run:** educator onboarding is excellent; add an equivalent parent first-run (consent → notification permission prompt → tour), which also fixes the orphaned ConsentScreen and the never-asked notification permission.

---

## 7. Prioritized roadmap

> Produced with the planning agent from these findings; each phase is independently shippable.
>
> **Status (July 3, 2026): ✅ Phase 0 implemented + all §8 quick wins — see `PHASE0_NOTES.md` for the change map and required manual steps (run `supabase-phase0-reconciliation.sql`, `eas init`, add `dailylog://auth` redirect URL, rebuild dev client). ✅ Phase 1 implemented — see `PHASE1_NOTES.md` (no manual steps). ✅ Phase 2 implemented — see `PHASE2_NOTES.md` (manual step: run `supabase-phase2-security.sql`). ✅ Phase 3 implemented — see `PHASE3_NOTES.md` (manual step: run `supabase-phase3.sql`). ✅ Phase 4 implemented — see `PHASE4_NOTES.md` (manual step: run `supabase-phase4.sql`). Next: Phase 5 (optional platform hygiene).**

### Phase 0 — Stabilize (schema, RLS, push, auth) — **L** ✅ DONE
1. **Schema reconciliation migration**: create `messages`, `photos` + `daily-log-photos` bucket, `educator_classrooms`, `profiles.phone`, `children.archived_at`.
2. **RLS write policies** for `profiles`, `daycares`, `classrooms`, `children` (INSERT+UPDATE), `parent_children`, `educator_classrooms`, `messages`, `photos`.
3. **Server-side profile creation** via `on auth.users` trigger reading `raw_user_meta_data` (also processes `pending_child_id`) — fixes OTP invites & signup RLS race.
4. **Push pipeline**: permission → `getExpoPushTokenAsync({ projectId })` → upsert `push_tokens`; create `default`/`urgent` Android channels; add EAS `projectId`; use installed `expo-device` for emulator guard.
5. **Deep links & recovery**: app `scheme`, magic-link/recovery URL handling, forgot-password screen.
6. **Fix `delete_my_account`** to remove `auth.users` (Edge Function / security-definer).
7. **Daily-log correctness**: educator-only upsert incl. `educator_id`; date passed Roster → DailyLog.
8. **Soft-delete children** (`archived_at`) + filter everywhere.
   - *Acceptance:* fresh signup → onboard → log → send delivers a real push; invited parent lands with a working profile; past logs open; removing a child preserves history.

### Phase 1 — Offline & reliability — **M** ✅ DONE
Route all mutations through `offlineQueue` (client UUIDs, idempotent), optimistic UI for entry lists, shared error helper + toast, pending-count in banner. *Acceptance:* airplane-mode logging works and syncs on reconnect; no silent failures.

### Phase 2 — Security hardening — **M** ✅ DONE
Scope storage reads by daycare/linkage (path convention `daycareId/childId/...`), classroom check on incident INSERT, column-safe `acknowledge_incident` RPC, rewrite educator policies onto `educator_classrooms`, re-review new tables. *Acceptance:* second test daycare can read nothing from the pilot daycare.

### Phase 3 — Educator & parent UX — **L** ✅ DONE
Educator inbox + `read_at` + message push; roster status RPC (kill N+1) + batched BulkLog + avatar URL cache; native date/time pickers; safe-area overhaul; nap timer; weekly child switcher; classroom incident list; roster quick-actions; accessibility labels. *Acceptance:* roster loads in 1–2 queries; educators never miss a parent message.

### Phase 4 — Differentiating features — **L** ✅ DONE
Attendance/check-in-out (roster + parent visibility) → medical/allergy/emergency-contact profiles (badges on log/bulk screens) → admin role UI → announcements w/ push fan-out → PDF/CSV export (`expo-print`/`expo-sharing`) → medication tracking. Each independently shippable with RLS.

### Phase 5 — Platform hygiene — **L**
Upgrade Expo SDK 54 → **56** (AGENTS.md mandates v56 docs — verify `expo-notifications` API changes there; consider pulling this ahead of Phase 0.4 to avoid rewriting push code twice). Env-based config (drop hardcoded keys), remove `@expo/ngrok` from deps, declare `@expo/vector-icons`, adopt or remove `expo-secure-store` (prefer it for session storage). Incremental TypeScript, ESLint/Prettier, unit tests (offlineQueue, useDailyLog, RLS harness), error boundaries, GitHub Actions CI + EAS build. *Acceptance:* clean `expo-doctor` on SDK 56; CI gate on PRs.

---

## 8. Quick wins (< 1 day each, do anytime) — ✅ all done (July 3, 2026)

1. ~~Pass `selectedDate` from Roster to DailyLog~~ ✅ (full fix incl. editing, date-aware header + copy)
2. ~~Fix the "Remove child" copy~~ ✅ (superseded: real soft-delete via `archived_at`)
3. ~~Wire up `ConsentScreen`~~ ✅ (consent gate on parent home, per child)
4. ~~Add `educator_id` to the daily-log insert~~ ✅
5. ~~Batch roster status~~ ✅ (RPC + batched fallback)
6. ~~Guard `WeeklySummaryScreen` negative `flex`~~ ✅
7. ~~Add "Forgot password?"~~ ✅ (+ full reset/recovery deep-link flow)
8. ~~Stop parents from attempting log INSERTs~~ ✅ (`createIfMissing` option)

---

*Report generated from a full read of all 33 source/SQL/config files in the repository. Next step suggestion: start with Phase 0 items 1–2 (one SQL migration file) since every other fix depends on the schema being reconciled.*





