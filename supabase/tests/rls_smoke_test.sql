-- ============================================================================
-- DailyLog — RLS smoke tests (Phase 0)
-- ============================================================================
-- Run against a database with migrations + seed applied:
--   supabase db reset && psql "$DATABASE_URL" -f supabase/tests/rls_smoke_test.sql
-- (or: supabase db reset already runs seed.sql; then run this file)
--
-- Impersonates each role by setting request.jwt.claims the way PostgREST does,
-- then asserts what each role can and cannot see/do. Every assertion raises on
-- failure, so a clean run prints only "PASS: ..." notices and ends with
-- 'RLS SMOKE TESTS: ALL PASSED'. Uses seed fixture ids (supabase/seed.sql).
-- ============================================================================

begin;

create or replace function test_impersonate(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function test_reset_role()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  -- fixture ids from supabase/seed.sql
  v_owner     uuid := '00000000-0000-4000-a000-000000000001'; -- Amara Osei, owner_admin
  v_admin     uuid := '00000000-0000-4000-a000-000000000002'; -- Dana Whitmore
  v_educator  uuid := '00000000-0000-4000-a000-000000000003'; -- Maria Kowalski, Infant room
  v_educator2 uuid := '00000000-0000-4000-a000-000000000004'; -- Sam Porter, Toddler room
  v_parent    uuid := '00000000-0000-4000-a000-000000000011'; -- Van Tran, guardian of child 1 ONLY
  v_parent2   uuid := '00000000-0000-4000-a000-000000000012'; -- Marc Danyar, children 2+3

  v_daycare   uuid := '10000000-0000-4000-a000-000000000001'; -- Sunny Grove
  v_infant_room     uuid := '20000000-0000-4000-a000-000000000001'; -- Infant room
  v_toddler_room     uuid := '20000000-0000-4000-a000-000000000002'; -- Toddler room
  v_child1    uuid := '30000000-0000-4000-a000-000000000001'; -- Ivy Tran (Infant); linked to v_parent
  v_child9    uuid := '30000000-0000-4000-a000-000000000009'; -- Ada Okafor (Toddler); NOT v_parent's, NOT Maria's room

  n int;
  v_uuid uuid;
begin
  -- ══════════════ ADMIN (owner_admin) ══════════════
  perform test_impersonate(v_owner);

  select count(*) into n from children;
  if n < 24 then
    raise exception 'FAIL admin: expected >=24 children, saw %', n;
  end if;
  raise notice 'PASS: admin sees all children (%)', n;

  select count(*) into n from daily_logs;
  if n = 0 then raise exception 'FAIL admin: sees no daily logs'; end if;
  raise notice 'PASS: admin sees daily logs (%)', n;

  insert into classrooms (daycare_id, name, age_group)
  values (v_daycare, 'RLS Test Room', 'Toddler') returning id into v_uuid;
  delete from classrooms where id = v_uuid;
  raise notice 'PASS: admin can create/delete classrooms';

  -- ══════════════ EDUCATOR (assigned to Infant room only) ══════════════
  perform test_reset_role();
  perform test_impersonate(v_educator);

  select count(*) into n from children where classroom_id = v_infant_room;
  if n = 0 then raise exception 'FAIL educator: sees no children in own room'; end if;
  raise notice 'PASS: educator sees own-room children (%)', n;

  -- reads across the daycare are allowed (roster views)...
  select count(*) into n from children where id = v_child9;
  if n = 0 then raise exception 'FAIL educator: cannot read daycare child'; end if;
  raise notice 'PASS: educator reads other-room child in same daycare';

  -- ...but WRITES outside assigned rooms must fail
  begin
    insert into daily_logs (daycare_id, child_id, educator_id, log_date)
    values (v_daycare, v_child9, v_educator, current_date + 30);
    raise exception 'FAIL educator: wrote log for unassigned room child';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'PASS: educator blocked from logging unassigned child';
  end;

  insert into daily_logs (daycare_id, child_id, educator_id, log_date)
  values (v_daycare, v_child1, v_educator, current_date + 30)
  returning id into v_uuid;
  delete from daily_logs where id = v_uuid;
  raise notice 'PASS: educator logs own-room child';

  -- educators must not touch billing
  select count(*) into n from invoices;
  if n > 0 then raise exception 'FAIL educator: can see invoices'; end if;
  raise notice 'PASS: educator sees zero invoices';

  -- ══════════════ PARENT (linked to child1 only) ══════════════
  perform test_reset_role();
  perform test_impersonate(v_parent);

  select count(*) into n from children where id <> v_child1;
  if n > 0 then
    raise exception 'FAIL parent: sees % children beyond own', n;
  end if;
  select count(*) into n from children where id = v_child1;
  if n = 0 then raise exception 'FAIL parent: cannot see own child'; end if;
  raise notice 'PASS: parent sees exactly their linked child';

  select count(*) into n from daily_logs where child_id <> v_child1;
  if n > 0 then raise exception 'FAIL parent: sees other children''s logs'; end if;
  raise notice 'PASS: parent sees only own child''s logs';

  begin
    insert into daily_logs (daycare_id, child_id, log_date)
    values (v_daycare, v_child1, current_date + 31);
    raise exception 'FAIL parent: created a daily log';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'PASS: parent blocked from writing daily logs';
  end;

  begin
    update children set first_name = 'Hacked' where id = v_child1;
    if exists (select 1 from children where id = v_child1 and first_name = 'Hacked') then
      raise exception 'FAIL parent: updated child record';
    end if;
    raise notice 'PASS: parent update on child silently filtered';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'PASS: parent blocked from updating child';
  end;

  -- parent CAN report an absence for their own child
  insert into attendance_records (daycare_id, child_id, date, status, absence_reason)
  values (v_daycare, v_child1, current_date + 32, 'absent', 'sick')
  returning id into v_uuid;
  raise notice 'PASS: parent reports absence for own child';

  -- but not for someone else's child
  begin
    insert into attendance_records (daycare_id, child_id, date, status)
    values (v_daycare, v_child9, current_date + 32, 'absent');
    raise exception 'FAIL parent: reported absence for unlinked child';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'PASS: parent blocked from unlinked child absence';
  end;

  -- ══════════════ SECOND PARENT sees nothing of parent1's child ══════════════
  perform test_reset_role();
  perform test_impersonate(v_parent2);

  select count(*) into n from children where id = v_child1;
  if n > 0 then raise exception 'FAIL parent2: sees parent1''s child'; end if;
  raise notice 'PASS: parent2 cannot see parent1''s child';

  -- ══════════════ ANON sees nothing ══════════════
  perform test_reset_role();
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  select count(*) into n from children;
  if n > 0 then raise exception 'FAIL anon: sees children'; end if;
  select count(*) into n from profiles;
  if n > 0 then raise exception 'FAIL anon: sees profiles'; end if;
  raise notice 'PASS: anon sees nothing';

  perform test_reset_role();
  raise notice 'RLS SMOKE TESTS: ALL PASSED';
end $$;

rollback;
