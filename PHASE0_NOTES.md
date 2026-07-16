# Phase 0 Implementation Notes — July 3, 2026

Phase 0 ("Stabilize") from `AUDIT_REPORT.md` §7 is implemented, plus all §8 quick wins.
This file lists **what changed** and the **manual steps you must do** before testing.

---

## ✅ What was implemented

| Audit finding | Fix | Where |
|---|---|---|
| 3.1 Push notifications dead | Full pipeline: permission → `getExpoPushTokenAsync({ projectId })` → upsert into `push_tokens`; Android `default` + `urgent` channels; tap-routing via navigation ref | `src/hooks/usePushNotifications.js`, `src/lib/navigationRef.js`, `App.js` |
| 3.2 Schema drift | `messages`, `photos` + `daily-log-photos` bucket, `educator_classrooms`, `profiles.phone`, `children.archived_at`, `daycares.created_by` | `supabase-phase0-reconciliation.sql` §1–5 |
| 3.3 Missing RLS write policies | INSERT/UPDATE/DELETE policies for `profiles`, `daycares`, `classrooms`, `children`, `parent_children` + daycare-wide educator policies on `children`/`daily_logs` | migration §6 |
| 3.4 Past-date logs | Roster passes `date` → DailyLog header shows the day (amber pill when not today), copy-yesterday is date-relative | `RosterScreen.js`, `DailyLogScreen.js`, `useDailyLog.js` |
| 3.5 Destructive remove-child | Soft delete via `children.archived_at`; roster/manage/bulk filter archived; history preserved | migration §1, `ManageScreen.js`, `ChildProfileScreen.js`, `BulkLogScreen.js`, `RosterScreen.js` |
| 3.6 Broken parent invites | `handle_new_user` auth trigger creates profiles from metadata + auto-links `pending_child_id`; client self-heal fallback; deep-link session handling; `emailRedirectTo: 'dailylog://auth'`; app `scheme` | migration §7, `useAuth.js`, `src/lib/authLinks.js`, `App.js`, `app.json`, both invite forms |
| 3.7 Deletion + recovery gaps | `delete_my_account()` now deletes `auth.users`; forgot-password + reset screens; PASSWORD_RECOVERY routing; profile-missing fallback screen | migration §8, `ForgotPasswordScreen.js`, `ResetPasswordScreen.js`, `LoginScreen.js`, `App.js`, `SettingsScreen.js` |
| 3.8 getOrCreateLog correctness | Educator-only creation (`createIfMissing` option), race-safe upsert (`ON CONFLICT DO NOTHING` + re-select), `educator_id` attribution, surfaced `error` state, parents read-only | `useDailyLog.js`, `DailyLogScreen.js`, `ParentHomeScreen.js` |
| 4.4 Roster N+1 | `get_classroom_log_status` RPC (1 query) with a 4-query batched fallback; BulkLog batched upsert + single duplicate check | migration §9, `RosterScreen.js`, `BulkLogScreen.js` |
| ConsentScreen orphaned | Consent gate on parent home: each child without `consent_given_at` must be consented before data shows | `ParentHomeScreen.js` |
| Weekly negative-flex crash | `Math.min/Math.max` clamps on activity bars | `WeeklySummaryScreen.js` |

New files: `supabase-phase0-reconciliation.sql`, `src/lib/navigationRef.js`, `src/lib/authLinks.js`,
`src/screens/shared/ForgotPasswordScreen.js`, `src/screens/shared/ResetPasswordScreen.js`.

---

## 🔧 Manual steps required (in order)

### 1. Run the migration
Supabase Dashboard → SQL Editor → paste & run **`supabase-phase0-reconciliation.sql`**.
It is idempotent (safe to re-run). Requires the four earlier `supabase-*.sql` files to have been run first.

### 2. Set your EAS project ID (push notifications)
```powershell
npx eas init      # or: npx eas build:configure
```
This writes the real `extra.eas.projectId` into `app.json` (replace the `YOUR_EAS_PROJECT_ID` placeholder). Push registration is skipped with a console warning until this is set.

### 3. Configure Supabase Auth redirect URLs
Dashboard → Authentication → URL Configuration → **Additional Redirect URLs** → add:
```
dailylog://auth
```
(Used by magic-link parent invites and password-reset emails.)

### 4. Rebuild the dev client / binaries
The new `scheme`, notification channels, and `expo-device` usage are **native config** — a JS-only reload is not enough:
```powershell
npx eas build --profile development --platform android   # and/or ios
```

### 5. (One-time data hygiene, optional)
If your live DB already had ad-hoc `messages`/`photos`/`educator_classrooms` tables, compare their columns with the migration before running it; the migration uses `create table if not exists` so existing tables are left untouched.

---

## 🧪 Acceptance test checklist (from the roadmap)

- [ ] Fresh educator signup → onboarding wizard completes with **no RLS errors**
- [ ] Add child → appears on roster; Invite parent (new email) → email arrives → tapping link opens the app → parent lands on ParentTabs **with a profile** and the child already linked
- [ ] Parent first open → **Consent screen** appears once per child, then day view
- [ ] Educator: fill log → **Send to parents** → parent device receives a push (requires steps 2–4)
- [ ] Incident submit → parent gets push; serious incidents use the `urgent` Android channel
- [ ] Roster ‹ › to yesterday → tap child → header shows 📅 amber date pill, entries editable, copy-from-previous-day works
- [ ] Remove child → child disappears from roster/manage/bulk; their `daily_logs`/`incident_reports` rows still exist in DB
- [ ] Login → "Forgot password?" → email link → **Reset password** screen appears → new password works
- [ ] Settings → Delete account → sign-in with the old credentials **fails**
- [ ] Roster with 10+ kids loads with 2 queries (RPC path) — check network inspector

## ⏭️ Next up (per roadmap)
Phase 1 — Offline & reliability (route all mutations through `offlineQueue`, optimistic entry updates, shared error toast). Then Phase 2 — security hardening (storage scoping, incident column safety).

