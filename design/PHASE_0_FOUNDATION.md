# Phase 0 — Foundation (repo + schema, no screens)

## 1. Monorepo
- pnpm workspaces: `apps/mobile`, `apps/web`, `packages/db`, `packages/shared`, `supabase/`
- Move the existing Expo app into `apps/mobile` preserving git history (`git mv` in-repo, or git subtree if repos merge)
- Scaffold `apps/web`: `create-next-app` (App Router, TS, Tailwind, ESLint); add TanStack Query + `@supabase/ssr`
- Root scripts: `typecheck`, `lint`, `dev` (per app). CI: GitHub Actions running typecheck+lint on PR
- Copy CLAUDE.md and DECISIONS.md from this package to repo root

## 2. Schema audit (the core task)
Walk `designs/flowmap-data.json` + the three design HTML files. Reconcile the EXISTING Supabase tables (auth, logging, chat already in use by mobile) with what the designs imply. Deliverable: migration files in `supabase/migrations`, not a doc.

Entity checklist implied by the designs (verify/extend against existing tables — rename to match what exists where sensible):

- `centers` — single row for now; every table below gets `center_id` FK
- `rooms` — name, age range, capacity, ratio rule (7a–f)
- `profiles` — one per auth user; `role`: owner_admin | admin | educator | parent
- `staff_members` — profile FK, room assignment, certifications, invite state (4a–4o, 10d)
- `children` — the core entity (20a, 19a): name, dob, room FK, photo, setup checklist state
- `guardians` — parent profile ↔ child links, relationship, pickup authorization (19c, 22c)
- `enrollments` — lifecycle: inquiry → tour → application → offer → enrolled → withdrawn (2b–2m); waitlist
- `attendance_records` — check-in/out, who, method (kiosk/educator), absences (8a–f, 19a)
- `daily_logs` — meals, naps, diapers/bathroom, notes, photos (educator 10a/11b; parent feed 6a) — EXISTS partially; extend
- `medications` + `medication_doses` + `medication_authorizations` (15a–c mobile, 20b web, parent 23a/15b)
- `incidents` — report, admin sign-off, parent acknowledgment (9b, 20a/b)
- `consents` — per-child consent records w/ versioning (14a–c parent, 22d)
- `conversations` + `messages` — EXISTS (mobile chat); extend for admin inbox 5a + broadcasts 5b/5c
- `announcements` + RSVPs (17a/b parent, 8a educator)
- `billing_plans`, `invoices`, `invoice_lines`, `payments`, `statements` (6a–j, parent 21a–d) — schema only in Phase 0, features in Phase 4
- `documents` — compliance vault + child/staff files (12c/d, 24d)
- `notifications` — per-user tray items (15a/b)
- `audit_log` — admin actions (11d)

Conventions: snake_case; `id uuid default gen_random_uuid()`; `created_at/updated_at timestamptz`; soft-delete only where designs show restore; every table `center_id uuid not null`.

## 3. RLS (do it now, not per-feature)
- Helper: `auth_profile()` / current role + center claims
- admins: full access within their center
- educators: read center children/rooms; write logs/attendance/incidents for assigned rooms
- parents: read ONLY their linked children's data (via guardians), write only their own consents/absences/messages
- Deny-by-default; write pgTAP or SQL smoke tests per role — this is the #1 foot-gun

## 4. Types & seed
- `supabase gen types typescript` → `packages/db/src/types.ts`; wrap client init (browser/server/native) in `packages/db`
- Seed script: 1 center, 3 rooms, 8 staff, 24 children with guardians, 2 weeks of logs/attendance — matching the fake data visible in the designs (Sunny Grove center, Amara Osei owner) so screens can be compared side-by-side

## Acceptance
- [ ] pnpm install + typecheck green at root; both apps run
- [ ] Existing mobile app still works pointed at the migrated schema
- [ ] RLS tests pass for all 4 roles
- [ ] `packages/db` exports typed client + generated types; web app renders a page listing seeded children (unstyled is fine)
