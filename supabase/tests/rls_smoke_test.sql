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
  v_invoice uuid;
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

  select count(*) into n from families;
  if n < 23 then
    raise exception 'FAIL admin: expected household backfill, saw % families', n;
  end if;
  raise notice 'PASS: admin sees household accounts (%)', n;

  select count(*) into n
    from children c
   where not exists (select 1 from family_children fc where fc.child_id = c.id);
  if n > 0 then
    raise exception 'FAIL household backfill: % children have no family', n;
  end if;
  raise notice 'PASS: every linked seeded child has a family account';

  if not has_permission('billing', 'edit') or not has_permission('staff', 'approve') then
    raise exception 'FAIL owner: default role is missing required permissions';
  end if;
  raise notice 'PASS: owner role matrix grants sensitive permissions';

  v_invoice := create_invoice(
    v_child1, v_parent, current_date + 14,
    '[{"description":"RLS ledger test","quantity":1,"unit_amount_cents":100}]'::jsonb
  );
  select count(*) into n from family_ledger_entries
   where source_invoice_id = v_invoice and entry_type = 'invoice' and amount_cents = 100;
  if n <> 1 then raise exception 'FAIL ledger: invoice did not create exactly one charge'; end if;
  raise notice 'PASS: invoice creates one family ledger charge';

  perform enqueue_child_notification(
    v_child1, 'daily_log', 'RLS outbox test', null,
    jsonb_build_object('childId', v_child1), 'rls-outbox-test', array['push']
  );
  select count(*) into n from notification_outbox where dedupe_key = 'rls-outbox-test';
  if n = 0 then raise exception 'FAIL outbox: child notification was not queued'; end if;
  raise notice 'PASS: notification enqueue creates durable delivery rows (%)', n;

  perform enqueue_email_notification(
    v_daycare, 'p0-test@example.com', 'parent_invite', 'RLS email outbox test',
    'Use the invitation code from the secure application flow.', '{}', 'rls-email-outbox-test'
  );
  select count(*) into n from notification_outbox
   where dedupe_key = 'rls-email-outbox-test'
     and recipient_email = 'p0-test@example.com'
     and recipient_id is null
     and channel = 'email';
  if n <> 1 then raise exception 'FAIL outbox: raw invite email was not queued exactly once'; end if;
  raise notice 'PASS: pre-account invitation email is queued without a profile row';

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

  select count(*) into n from families;
  if n < 23 then raise exception 'FAIL educator: cannot read center families'; end if;
  raise notice 'PASS: educator reads center family directory (%)', n;

  insert into families (daycare_id, display_name)
  values (v_daycare, 'Lead educator permission test') returning id into v_uuid;
  delete from families where id = v_uuid;
  raise notice 'PASS: lead educator children-edit permission is enforced positively';

  begin
    insert into conversations (daycare_id, child_id, kind)
    values (v_daycare, v_child9, 'direct');
    raise exception 'FAIL educator: opened a thread for an unassigned child';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'PASS: household identity does not widen educator messaging access';
  end;

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

  if not has_permission('daily_logs', 'edit') or has_permission('billing', 'view') then
    raise exception 'FAIL educator: role permission matrix returned unexpected values';
  end if;
  raise notice 'PASS: educator role matrix grants care work and denies billing';

  -- Linked demo databases may already have an open shift. Remove it as the
  -- test harness role inside this rollback-only transaction before exercising
  -- a fresh clock cycle. Closing it at `now()` would overlap the intentional
  -- five-minute test entry and correctly trip the database overlap guard.
  if exists (
    select 1
      from staff_time_entries
     where staff_member_id = my_staff_member_id()
       and clocked_out_at is null
  ) then
    perform test_reset_role();
    delete from staff_time_entries
     where staff_member_id = (
       select id from staff_members
        where profile_id = v_educator
          and daycare_id = v_daycare
     )
       and clocked_out_at is null;
    perform test_impersonate(v_educator);
  end if;

  v_uuid := clock_in(null, now() - interval '5 minutes');
  perform clock_out(now(), 0);
  select count(*) into n from staff_time_entries
   where id = v_uuid and status = 'submitted' and clocked_out_at is not null;
  if n <> 1 then raise exception 'FAIL timekeeping: clock-in/out was not submitted'; end if;
  raise notice 'PASS: staff can clock in and submit their own time entry';

  -- educators must not touch billing
  select count(*) into n from invoices;
  if n > 0 then raise exception 'FAIL educator: can see invoices'; end if;
  raise notice 'PASS: educator sees zero invoices';

  begin
    perform get_parent_push_tokens(v_child1);
    raise exception 'FAIL educator: legacy RPC exposed guardian device tokens';
  exception when insufficient_privilege then
    raise notice 'PASS: legacy device-token lookup is no longer client-callable';
  end;

  -- Floater has children view but not edit in the seeded matrix.
  perform test_reset_role();
  perform test_impersonate(v_educator2);
  if not has_permission('children', 'view') or has_permission('children', 'edit') then
    raise exception 'FAIL floater: seeded children permission mismatch';
  end if;
  begin
    insert into families (daycare_id, display_name)
    values (v_daycare, 'Unauthorized family');
    raise exception 'FAIL floater: created a family without children edit permission';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS: role matrix blocks floater child/family edits';
  end;

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

  select count(*) into n from families;
  if n <> 1 then raise exception 'FAIL parent: expected 1 family, saw %', n; end if;
  select count(*) into n from family_children;
  if n <> 1 then raise exception 'FAIL parent: expected 1 family child, saw %', n; end if;
  raise notice 'PASS: parent sees exactly their household and child';

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

  select count(*) into n from families;
  if n <> 1 then raise exception 'FAIL parent2: expected 1 family, saw %', n; end if;
  select count(*) into n from family_children;
  if n <> 2 then
    raise exception 'FAIL parent2: Danyar household should contain 2 children, saw %', n;
  end if;
  raise notice 'PASS: siblings share one household account';

  -- ══════════════ RPC AUTHORIZATION SURFACE ══════════════
  -- definer functions enforce their own role checks — prove the denials.

  perform test_reset_role();
  perform test_impersonate(v_educator);

  begin
    perform create_invoice(v_child1, null, current_date + 14,
      '[{"description":"x","quantity":1,"unit_amount_cents":100}]'::jsonb);
    raise exception 'FAIL educator: created an invoice';
  exception when others then
    if sqlerrm not like '%Only admins%' then raise; end if;
    raise notice 'PASS: educator blocked from creating invoices';
  end;

  begin
    perform admin_set_user_role(v_parent, 'admin');
    raise exception 'FAIL educator: changed a role';
  exception when others then
    if sqlerrm not like '%Only admins%' then raise; end if;
    raise notice 'PASS: educator blocked from role changes';
  end;

  if exists (select 1 from get_billing_summary()) then
    raise exception 'FAIL educator: read the billing summary';
  end if;
  raise notice 'PASS: educator gets no billing summary';

  perform test_reset_role();
  perform test_impersonate(v_parent);

  begin
    perform kiosk_check(v_child1, '0000');
    raise exception 'FAIL parent: drove the kiosk';
  exception when others then
    if sqlerrm not like '%Attendance permission%' then raise; end if;
    raise notice 'PASS: parent blocked from the kiosk';
  end;

  begin
    perform create_pickup(v_child9, 'Sneaky Stranger', null, null);
    raise exception 'FAIL parent: added a pickup to an unlinked child';
  exception when others then
    if sqlerrm not like '%No access%' then raise; end if;
    raise notice 'PASS: parent blocked from unlinked-child pickups';
  end;

  -- ══════════════ ANON sees nothing ══════════════
  perform test_reset_role();
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  select count(*) into n from children;
  if n > 0 then raise exception 'FAIL anon: sees children'; end if;
  select count(*) into n from profiles;
  if n > 0 then raise exception 'FAIL anon: sees profiles'; end if;
  select count(*) into n from families;
  if n > 0 then raise exception 'FAIL anon: sees families'; end if;
  raise notice 'PASS: anon sees nothing, including family accounts';

  perform set_config(
    'request.headers',
    '{"x-forwarded-for":"203.0.113.10","user-agent":"dailylog-rls-test"}',
    true
  );
  for n in 1..5 loop
    perform submit_enrollment_inquiry(
      v_daycare, 'Rate Test', 'rate' || n || '@example.com', null,
      'Child ' || n, date '2024-01-01', null, null
    );
  end loop;
  begin
    perform submit_enrollment_inquiry(
      v_daycare, 'Rate Test', 'rate6@example.com', null,
      'Child 6', date '2024-01-01', null, null
    );
    raise exception 'FAIL rate limit: sixth anonymous inquiry was accepted';
  exception when others then
    if sqlerrm not like '%Too many attempts%' then raise; end if;
    raise notice 'PASS: anonymous enrollment inquiry rate limit is enforced';
  end;

  perform test_reset_role();
  raise notice 'RLS SMOKE TESTS: ALL PASSED';
end $$;

rollback;
