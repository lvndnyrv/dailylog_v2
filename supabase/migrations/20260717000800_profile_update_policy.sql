-- ============================================================================
-- DailyLog — non-recursive self-profile updates
-- ============================================================================

-- The original policy selected from profiles inside a profiles policy, which
-- Postgres correctly rejects as recursive. The identity helpers are security
-- definer functions specifically intended for safe use in RLS predicates.
drop policy if exists "users update own profile" on profiles;
create policy "users update own profile" on profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = get_my_role()
    and daycare_id is not distinct from get_my_daycare_id()
  );
