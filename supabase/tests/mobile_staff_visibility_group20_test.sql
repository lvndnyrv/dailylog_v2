-- Group 20 security and workflow smoke tests. Requires the Group 20 demo seed.
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
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_parent uuid := '00000000-0000-4000-a000-000000000023';
  v_unrelated_parent uuid := '00000000-0000-4000-a000-000000000011';
  v_event uuid := '82000000-0000-4000-a000-000000000001';
  v_allowed_child uuid := '30000000-0000-4000-a000-000000000013';
  v_declined_child uuid := '30000000-0000-4000-a000-000000000014';
  v_room uuid := '20000000-0000-4000-a000-000000000003';
  v_summary jsonb;
  v_consents jsonb;
  v_log uuid;
  v_failed boolean := false;
begin
  perform pg_temp.as_postgres();
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, current_date), current_date)
   where id in (v_allowed_child, v_declined_child);
  update public.announcements
     set event_at = now() + interval '7 days',
         event_ends_at = now() + interval '7 days 3 hours'
   where id = v_event;
  perform pg_temp.impersonate(v_owner);
  v_summary := public.get_mobile_event_rsvp_summary(v_event);
  if (v_summary #>> '{counts,going}')::int <> 1
     or (v_summary #>> '{counts,maybe}')::int <> 1
     or (v_summary #>> '{counts,no}')::int <> 1
     or (v_summary #>> '{counts,noReply}')::int < 1 then
    raise exception 'FAIL: owner RSVP summary counts are incorrect: %', v_summary -> 'counts';
  end if;
  raise notice 'PASS: staff see family-level RSVP counts and non-responders';

  v_consents := public.get_mobile_classroom_consents(v_room);
  if jsonb_array_length(v_consents -> 'children') < 6 then
    raise exception 'FAIL: seeded classroom consent roster is incomplete';
  end if;
  raise notice 'PASS: staff see the classroom consent matrix';

  perform pg_temp.as_postgres();
  perform pg_temp.impersonate(v_parent);
  v_consents := public.get_mobile_child_consents(v_allowed_child);
  if jsonb_array_length(v_consents -> 'items') <> 4 then
    raise exception 'FAIL: parent did not receive all four consent types';
  end if;
  perform public.set_mobile_parent_consent(v_allowed_child, 'Water / splash play', false);
  if public.child_has_active_consent(v_allowed_child, 'Water / splash play') then
    raise exception 'FAIL: parent consent revocation did not apply immediately';
  end if;
  perform public.send_mobile_event_rsvp(v_event, 'maybe', 2);
  raise notice 'PASS: linked parent can manage consent and submit full RSVP data';

  perform pg_temp.as_postgres();
  perform pg_temp.impersonate(v_unrelated_parent);
  begin
    perform public.get_mobile_child_consents(v_allowed_child);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: unrelated parent read another child consent'; end if;
  raise notice 'PASS: unrelated parent cannot read another child consent';

  perform pg_temp.as_postgres();
  perform pg_temp.impersonate(v_educator);
  if public.child_has_active_consent(v_declined_child, 'Photo & media consent') then
    raise exception 'FAIL: declined photo consent was reported as active';
  end if;

  select log.id into v_log
    from public.daily_logs log
   where log.child_id = v_declined_child
   order by log.log_date desc limit 1;
  if v_log is null then
    insert into public.daily_logs (daycare_id, child_id, educator_id, log_date)
    values (
      '10000000-0000-4000-a000-000000000001', v_declined_child,
      v_educator, public.center_today()
    ) returning id into v_log;
  end if;

  v_failed := false;
  begin
    insert into public.photos (daily_log_id, uploader_id, storage_path)
    values (v_log, v_educator, 'group20-test/declined.jpg');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: photo metadata bypassed declined consent'; end if;
  raise notice 'PASS: database blocks photo creation after declined consent';
end;
$$;

rollback;
select 'MOBILE GROUP 20 TESTS: ALL PASSED' as result;
