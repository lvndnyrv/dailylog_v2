# Handoff: DailyLog — Web Admin (Phase 0 + Phase 1)

## Overview
DailyLog is a daycare management product with three surfaces sharing one Supabase backend:
- **Educator mobile** (React Native/Expo) — daily logging, classroom management, chat
- **Parent mobile** (React Native/Expo) — child's day feed, messages, billing, consent
- **Admin web** (NEW — this handoff) — center operations console: staff, children, rooms, attendance, billing, enrollment, compliance

This package covers the first two implementation phases of the web admin, plus the repo/schema foundation both apps share. The full roadmap is in PLAN.md.

## About the design files
The files in `designs/` are **design references created in HTML** — high-fidelity prototypes showing intended look and behavior. They are NOT production code to copy. The task is to **recreate these designs in the target stack** (Next.js App Router + TypeScript + Tailwind, per DECISIONS.md), using its idioms.

Open `designs/DailyLog WEB - Admin.dc.html` directly in a browser. Every screen has an id badge (e.g. `20a`) and a `data-screen-label` attribute; specs in this package reference those ids. `designs/flowmap-data.json` is the machine-readable index of all ~200 screens across the three apps.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and copy are final — recreate pixel-faithfully (translating to Tailwind utilities/tokens is fine; visual result should match). Interactions shown as static states (hover rows, popovers, modals) should behave as real interactions.

## Repo context
Target structure (create in Phase 0):

```
dailylog/
├─ apps/
│  ├─ mobile/        ← existing Expo app moves here
│  └─ web/           ← new Next.js admin (this handoff)
├─ packages/
│  ├─ db/            ← Supabase client + generated types + query helpers
│  └─ shared/        ← domain rules used by both apps
├─ supabase/         ← migrations, RLS policies, seed, edge functions
├─ design/           ← this handoff package
└─ CLAUDE.md         ← repo conventions (starter included here)
```

Mobile and web never talk to each other — both read/write the same Postgres via Supabase (Auth + RLS + Realtime + Storage). The schema is the contract.

## Phases in this package
1. **PHASE_0_FOUNDATION.md** — monorepo setup + schema audit + RLS + seed. No screens. Do this first.
2. **PHASE_1_WEB_SHELL.md** — auth screens, app shell, children roster/profile, staff roster/profile, invites.

## Design tokens (admin web)

### Type
- Primary UI font: **Lato** (400/600/700/800), Google Fonts
- Secondary (data/tables where used): **IBM Plex Sans** (400–700)
- Mono (codes, invite tokens, ids): **IBM Plex Mono** (500/600)
- Screen titles: 800 ~24px Lato · Section/card titles: 700–800 14–16px · Body/rows: 400–600 13–13.5px · Meta/labels: 600 10.5–11.5px, often uppercase +0.06–0.1em tracking

### Color
- Ink (headings): `#17335B`  · Body: `#41546F` / `#3D4E68` · Muted: `#5B6B82` · Faint: `#8FA6C4`
- Canvas: `#F4F8FD` · Card/sidebar: `#FFFFFF` · Hairline: `#E4ECF6` (also `#E3EDFA` tint fills)
- **Primary (brand accent): `#2F7CD8`**, hover `#1E5FB0` — themeable: the designs expose it as a variable; implement as a CSS custom property / Tailwind token, not hardcoded
- Success: `#1F8A5B` / dark `#1F6F4A` · Warning: `#F0B441`, text `#B0782B`, bg `#FBF3E4` · Danger: `#C24747`, bg `#FAE7E7`
- Links: `#2F7CD8`, hover `#1E5FB0`

### Shape & layout
- Admin screens designed at **1240px wide**; sidebar **214px** fixed, white, 1.5px `#E4ECF6` right border
- Content canvas `#F4F8FD`; cards white, radius 12–16px, border `rgba(23,51,91,.1)`, shadow `0 2px 12px rgba(23,51,91,.08)`
- Nav items: radius 11px, 9px 12px padding; active = primary bg + white text; count badges = pill, 999px
- Buttons: primary = primary color, white text, radius ~10–12px; secondary = white, hairline border
- Tables: white rows, hairline dividers, uppercase 10.5px column headers, row hover tint

### Mobile apps (for later phases / shared feel)
- Same palette on `#F4F8FD` canvas, Lato only, phone frame 390px
- Tweakable props in the design files: `primary` (default `#2F7CD8`) and `buttonShape` (default "Pill"; **owner currently leaning "Rounded"** — treat as an open decision in DECISIONS.md)

## Interactions & behavior (global)
- Sidebar nav persists across all admin screens; active section highlighted; Billing/Compliance show count badges from live data
- Header per section: title, search, "+ New" create menu (18b), location switcher (18d — stub in Phase 1, single center), notification bell (15a — stub), account menu (14a)
- Tables: row click opens detail; row action menu (18a) on hover/kebab; bulk select (18c) later
- Modals: centered, white, radius ~16px, dim overlay; popovers anchored to trigger
- Loading: skeleton rows/blocks in canvas tints; Empty states: designed per screen (see HTML)
- All screens keyboard-reachable; global search overlay (9d) is a later phase

## State & data
- Auth/session: Supabase Auth (email+password now; invite-accept flow 10d). Roles: `owner_admin`, `admin`, `educator`, `parent` — enforced by RLS (see PHASE_0)
- Server state: TanStack Query wrapping `packages/db` query helpers; optimistic updates for row edits
- Realtime: Supabase Realtime channels for notification tray + messages (Phase 3); design for it, stub now

## Assets
- Fonts from Google Fonts (Lato, IBM Plex Sans/Mono)
- Icons in the designs are simple inline SVG strokes (15–16px, 1.7 stroke) — use **Lucide** icons in code (closest match), size 15–16, stroke ~1.75
- Photos/avatars: initials-on-tint avatars (see designs); image slots in designs mark where real photos go (child photos via Supabase Storage, Phase 2+)

## Files in this package
- `README.md` — this file
- `PLAN.md` — full phased roadmap + architecture rationale
- `PHASE_0_FOUNDATION.md` / `PHASE_1_WEB_SHELL.md` — build specs with acceptance checklists
- `CLAUDE.md` — starter conventions file → copy to repo root
- `DECISIONS.md` — decision log starter → copy to repo root
- `designs/DailyLog WEB - Admin.dc.html` — 133 admin surfaces (THE reference for this handoff)
- `designs/DailyLog Mobile - Educator.dc.html`, `designs/DailyLog Mobile - Parent.dc.html` — mobile designs (schema audit input + later phases)
- `designs/DailyLog Flow Map.dc.html` + `designs/flowmap-data.json` — cross-app flow map
- `designs/support.js`, `designs/image-slot.js` — runtime the design HTML needs to render; not product code
