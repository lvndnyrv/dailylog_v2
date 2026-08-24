-- Group 23 security and workflow smoke tests. Requires the Group 23 demo seed.
begin;

create or replace function pg_temp.impersonate(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_maria uuid := '00000000-0000-4000-a000-000000000003';
  v_other_educator uuid := '00000000-0000-4000-a000-000000000004';
  v_room uuid := '20000000-0000-4000-a000-000000000003';
  v_sick_child uuid := '30000000-0000-4000-a000-000000000016';
  v_awaited_child uuid := '30000000-0000-4000-a000-000000000017';
  v_late_child uuid := '30000000-0000-4000-a000-000000000014';
  v_pass uuid := '42320000-0000-4000-a000-000000000001';
  v_roll jsonb;
  v_complete jsonb;
  v_late record;
  v_failed boolean := false;
begin
  perform pg_temp.impersonate(v_maria);
  v_roll := public.get_mobile_roll_call(v_room);
  if (v_roll #>> '{summary,present}')::integer <> 6
     or (v_roll #>> '{summary,absent}')::integer <> 1
     or (v_roll #>> '{summary,awaited}')::integer <> 2 then
    raise exception 'FAIL: seeded roll call summary is incomplete: %', v_roll -> 'summary';
  end if;
  raise notice 'PASS: assigned educator sees live present, absent and awaited states';

  perform pg_temp.as_postgres();
  perform pg_temp.impersonate(v_other_educator);
  begin
    perform public.mobile_roll_call_check_in(v_awaited_child);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: an educator changed attendance outside their assigned classroom';
  end if;
  raise notice 'PASS: roll-call mutations remain classroom scoped';

  perform pg_temp.as_postgres();
  perform pg_temp.impersonate(v_maria);
  perform public.mobile_roll_call_check_in(v_awaited_child);
  perform public.mobile_mark_child_absent(v_sick_child, 'appointment', 'Dentist at 9:30', true);
  v_complete := public.complete_mobile_roll_call(v_room);
  if (v_complete ->> 'present')::integer <> 7
     or (v_complete ->> 'absent')::integer <> 2
     or (v_complete ->> 'awaited')::integer <> 0 then
    raise exception 'FAIL: roll-call completion totals are wrong: %', v_complete;
  end if;
  raise notice 'PASS: educator check-in, absence and completion are persisted';

  perform pg_temp.as_postgres();
  if not exists (
    select 1 from public.notification_outbox outbox
     where outbox.kind = 'attendance'
       and outbox.payload ->> 'childId' = v_sick_child::text
       and outbox.recipient_id = v_owner
  ) then
    raise exception 'FAIL: absence office alert was not queued';
  end if;
  raise notice 'PASS: notify-office queues auditable admin delivery';

  insert into public.pickup_passes (
    id, daycare_id, child_id, presenter_profile_id, presenter_name,
    relationship, token_hash, code_hash, expires_at, created_by
  ) values (
    v_pass, '10000000-0000-4000-a000-000000000001', v_late_child,
    '00000000-0000-4000-a000-000000000024', 'Miguel Reyes', 'Father',
    digest('group23-test-token', 'sha256'), digest('230023', 'sha256'),
    now() + interval '10 minutes', '00000000-0000-4000-a000-000000000024'
  );

  perform pg_temp.impersonate(v_maria);
  select * into v_late
    from public.complete_mobile_late_pickup(v_pass, 'Traffic at closing time');
  if v_late.late_minutes < 20
     or v_late.fee_cents <= 0
     or v_late.late_pickup_event_id is null then
    raise exception 'FAIL: verified late pickup did not calculate and persist: %', row_to_json(v_late);
  end if;
  raise notice 'PASS: pass verification and late-pickup policy complete atomically';
end;
$$;

rollback;
select 'MOBILE GROUP 23 TESTS: ALL PASSED' as result;
