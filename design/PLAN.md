# DailyLog — Implementation Plan (v1, 2026-07-15)

## Stack (see DECISIONS.md for rationale)
Next.js (App Router) + TS + Tailwind · Supabase (keep) · Expo/RN (keep) · pnpm monorepo · Vercel + Supabase Cloud + EAS · offline-tolerant (not offline-first) · single-center UX with `center_id` on every table · payments deferred (Stripe candidate).

## Principles
- Schema-first: the ~133 admin surfaces are views over ~10 core entities. Postgres is the durable asset; screens are replaceable.
- Reuse the existing Expo code (auth, logging, chat); restyle mobile screens to the new design as each feature is touched — no big-bang rewrite.
- Mobile ↔ web link only through the shared database (+ Realtime). Shared types/rules in `packages/`.
- Log gaps in DECISIONS.md instead of stalling — designs answer *what it looks like*, dev decides *what happens when*.

## Phases
- **0 Foundation** — monorepo, schema audit, RLS, seed. Exit: both apps compile against `packages/db`.
- **1 Web shell + people data** — auth (10a–e), shell (nav/header/14a/15a stub), children roster 20a, child profile 19a/19b, staff 4a/4b, invite 4f. Exit: admin manages real children & staff.
- **2 Daily ops** — attendance 8a–f + kiosk 8b, rooms & ratios 7a–f, incident sign-off 9b, dashboard 9a last. Mobile: educator home 2a–c + quick log on same tables.
- **3 Communication** — web messages/broadcasts 5a–c on the existing chat schema, parent announcements 17a/b, Expo push + web toasts 15d.
- **4 Money** — billing 6a–j manual-first, then Stripe autopay + parent billing 21a–d.
- **5 Growth & compliance** — enrollment 2b–2m + public form 2g + parent offer flow 24a–h, reports 13, compliance 12, settings 11, activity 15b, devices 16, help 17.

Screen ids reference `designs/flowmap-data.json`.
