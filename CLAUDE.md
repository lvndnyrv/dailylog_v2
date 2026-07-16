@AGENTS.md

# DailyLog — repo conventions (starter)

## What this is
Daycare management: Expo mobile (educator + parent) and Next.js web admin over one Supabase backend. Design references live in `design/` — HTML prototypes, high-fidelity; recreate, never copy their code.

## Stack
pnpm monorepo · apps/mobile (Expo, existing) · apps/web (Next.js App Router + TS + Tailwind + TanStack Query) · packages/db (Supabase client + generated types + queries) · packages/shared (domain rules) · supabase/ (migrations, RLS, seed).

## Rules
- Schema-first: any feature starts with a migration in `supabase/migrations`, then `pnpm gen:types`, then queries in `packages/db`, then UI.
- Every table has `center_id`; RLS deny-by-default; never bypass RLS with the service key in app code.
- Business rules live in `packages/shared`, not inside screens.
- Web UI: Tailwind tokens map to design tokens in `design/README.md` (primary `#2F7CD8` as `--primary`, ink `#17335B`, canvas `#F4F8FD`, hairline `#E4ECF6`). Font: Lato (+ IBM Plex Mono for codes). Icons: Lucide 15–16px.
- Mobile: reuse existing modules; when touching a screen, restyle it to the new design (design/designs/*.dc.html) in the same PR.
- When the design doesn't answer a behavior question: make the smallest sensible choice and append it to DECISIONS.md. Do not stall, do not invent big features.
- Never edit `design/` contents — it's the reference, owned by the design side.

## Web conventions (emerged in Phase 1)
- Pages are server components: fetch via `packages/db` query helpers with the cookie-scoped client from `src/lib/supabase/server.ts`; interactivity lives in `src/components/<domain>/*` client components.
- Mutations are server actions in `src/lib/<domain>/actions.ts` (useActionState pattern: `{error?, ok?}` state), followed by `revalidatePath`.
- Modals use `src/components/ui/modal.tsx` (430–720px, radius 22px, Esc/backdrop close). Buttons use the `rounded-btn` token — **never** the design's 999px pills (buttonShape=Rounded, DECISIONS.md).
- Auth/session refresh lives in `src/proxy.ts` (Next 16 renamed middleware→proxy); role checks live in layouts/pages, not the proxy.
- New RPCs/tables: migration → add to `packages/db/src/types.gen.ts` placeholder (until gen:types runs against a DB) → query helper → UI.

## Commands
- `pnpm install` — workspace install (root)
- `pnpm typecheck` / `pnpm lint` — all packages (CI runs both on PR)
- `pnpm dev:web` — Next.js admin · `pnpm dev:mobile` — Expo
- `pnpm db:start` / `pnpm db:reset` — local Supabase (needs Docker + CLI); reset applies `supabase/migrations` + `supabase/seed.sql`
- `pnpm gen:types` — regenerate `packages/db/src/types.gen.ts` (currently a hand-written placeholder)
- RLS tests: `psql $DATABASE_URL -f supabase/tests/rls_smoke_test.sql` after db reset
- Seed logins: password `password123`, e.g. `amara@sunnygrove.test` (owner) — local only
