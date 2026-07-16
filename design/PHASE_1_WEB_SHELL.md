# Phase 1 — Web shell + people data

Reference: `designs/DailyLog WEB - Admin.dc.html` (open in browser, use id badges). All screens 1240px design width; implement responsive down to ~1024px (sidebar collapses to icons is acceptable; not designed — log choices to DECISIONS.md).

## Module A — Auth & entry (`/sign-in`, `/invite`, `/forgot`, `/start`)
Screens: **10a** sign in (split layout: 530px form panel + brand panel) · **10b** two-step check · **10c** forgot password · **10d** accept invite (educator/admin invited via 4f) · **10e** start a center (self-serve owner signup → creates center + owner_admin profile)
Behavior: Supabase Auth email+password; invite tokens single-use w/ expiry; post-auth redirect by role (admins → dashboard; educators → mobile-app interstitial). 2FA can ship as email OTP first (log in DECISIONS.md).

## Module B — App shell (layout route)
From any admin screen (e.g. 20a): sidebar 214px (center identity top; nav Dashboard/Staff/Children/Rooms & ratios/Enrollment/Attendance/Billing/Messages/Compliance/Reports/Settings; account footer) · header (section title, search field, "+ New" menu 18b, bell 15a, account menu 14a) · canvas `#F4F8FD`.
Phase-1 stubs: bell opens empty tray; location switcher 18d hidden (single center); non-built nav items route to a designed-empty placeholder; Billing/Compliance badges hidden until those phases.
Account menu 14a → admin profile modal 14d, sign-out confirm 14b → signed-out landing 14c.

## Module C — Children (`/children`)
Screens: **20a** roster (section home: table of all children across rooms; columns child/room/guardians/setup/medical flags; filters; row → profile) · **20b** medical & allergies register · **19a** child profile (tabbed record: overview, guardians & pickups, medical, documents, activity) · **19b** setup panel (checklist driving the roster's setup column) · **19c** add pickup modal · **19d** edit child modal · row action menu **18a** · create child via **18b**
Data: children, guardians, rooms (read), medications (read summary), consents (read status).
Acceptance: create/edit child; link guardian by email invite (creates parent invite); add authorized pickup; setup checklist state persists; medical register matches seeded allergies.

## Module D — Staff (`/staff`)
Screens: **4a** staff roster (table: name/role/room/certs/status) · **4b** educator profile · **4f** invite educator modal (→ 10d flow) · **4d** invite lifecycle states · **4i** edit profile modal · **4o** roles overview (read-only list in Phase 1; permissions matrix 4e is Phase 5)
Acceptance: invite educator end-to-end (email → 10d → appears in roster as active); assign to room; cert fields stored (expiry logic Phase 5).

## Out of scope for Phase 1 (do NOT build yet)
Dashboard 9a (Phase 2 — needs ops data) · global search 9d · notifications content · timesheets 4c/4j–4m · bulk actions 18c/4n · devices 16 · help 17.

## Definition of done (phase)
- [ ] All Module A–D screens visually match the reference HTML side-by-side
- [ ] RLS verified: educator/parent credentials cannot access admin routes or others' data
- [ ] Seed data renders correctly on every built screen; empty states shown on a fresh center (10e path)
- [ ] Lighthouse a11y ≥ 90 on roster + profile; all tables keyboard-navigable
