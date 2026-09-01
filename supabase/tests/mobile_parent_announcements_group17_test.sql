-- Parent Mobile Group 17 — announcements and RSVP security smoke tests.
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
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;

do $$
declare
  v_parent uuid := '00000000-0000-4000-a000-000000000023';
  v_event uuid := '82000000-0000-4000-a000-000000000001';
  v_child uuid := '30000000-0000-4000-a000-000000000013';
  v_other_child uuid := '30000000-0000-4000-a000-000000000002';
  v_original_start timestamptz;
  v_result jsonb;
  v_failed boolean := false;
begin
  if (
    select count(*)
      from pg_publication_tables publication_table
     where publication_table.pubname = 'supabase_realtime'
       and publication_table.schemaname = 'public'
       and publication_table.tablename in ('announcements', 'announcement_rsvps', 'announcement_reads')
  ) <> 3 then
    raise exception 'FAIL: Group 17 realtime tables are not fully published';
  end if;
  raise notice 'PASS: announcement feed and RSVP state are realtime-enabled';

  perform pg_temp.impersonate(v_parent);
  v_result := public.send_mobile_event_rsvp(v_event, 'maybe', 2, v_child);
  if v_result ->> 'childId' <> v_child::text
     or v_result ->> 'response' <> 'maybe'
     or (v_result ->> 'guests')::int <> 2 then
    raise exception 'FAIL: the child-aware RSVP result is incorrect: %', v_result;
  end if;
  raise notice 'PASS: parent RSVP is associated with the explicitly invited child';

  perform pg_temp.as_postgres();
  perform pg_temp.impersonate(v_parent);
  begin
    perform public.send_mobile_event_rsvp(v_event, 'yes', 2, v_other_child);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a parent submitted an RSVP for another family child';
  end if;
  raise notice 'PASS: parent cannot RSVP with an unrelated child';

  perform pg_temp.as_postgres();
  select event_at into v_original_start from public.announcements where id = v_event;
  update public.announcements set event_at = now() - interval '1 minute' where id = v_event;
  perform pg_temp.impersonate(v_parent);
  v_failed := false;
  begin
    perform public.send_mobile_event_rsvp(v_event, 'yes', 2, v_child);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a parent submitted an RSVP after the event started';
  end if;
  perform pg_temp.as_postgres();
  update public.announcements set event_at = v_original_start where id = v_event;
  raise notice 'PASS: RSVP closes when the event starts';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 17 TESTS: ALL PASSED' as result;
