-- Rollback-safe Group 9 dashboard action and role-boundary checks.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', case when p_role = 'postgres' then 'service_role' else p_role end)::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_parent uuid;
  v_daycare uuid;
  v_room uuid := '20000000-0000-4000-a000-000000000001';
  v_nudge uuid;
  v_expected uuid;
  v_credential uuid;
  v_result jsonb;
begin
  select daycare_id into v_daycare from public.profiles where id = v_owner;
  select id into v_parent from public.profiles where daycare_id = v_daycare and role = 'parent' limit 1;
  select credential.id into v_credential
    from public.staff_credentials credential
    join public.staff_members staff on staff.id = credential.staff_member_id
   where staff.profile_id = v_educator and credential.archived_at is null
   limit 1;
  if v_daycare is null or v_parent is null or v_credential is null then
    raise exception 'Missing Group 9 dev fixtures';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  if not public.has_permission('rooms', 'edit') then
    raise exception 'FAIL: rooms permission alias did not preserve owner access';
  end if;

  v_result := public.create_room_activity_nudge(v_room, 'expected');
  v_expected := (v_result ->> 'id')::uuid;
  if not exists (
    select 1 from public.room_activity_nudges
    where id = v_expected and mode = 'expected' and snoozed_until > now()
  ) then raise exception 'FAIL: expected room activity did not persist its quiet window'; end if;

  v_result := public.create_room_activity_nudge(v_room, 'nudge');
  v_nudge := (v_result ->> 'id')::uuid;
  if coalesce((v_result ->> 'queued')::integer, 0) < 1 then
    raise exception 'FAIL: room nudge did not queue an educator notification';
  end if;
  if not exists (
    select 1 from public.notification_outbox
    where payload ->> 'nudgeId' = v_nudge::text and kind = 'room_activity_nudge'
  ) then raise exception 'FAIL: room nudge has no durable push delivery'; end if;

  v_result := public.send_staff_credential_reminder(v_credential, true);
  if not coalesce((v_result ->> 'sent')::boolean, false)
     or not coalesce((v_result ->> 'followUpScheduled')::boolean, false) then
    raise exception 'FAIL: credential reminder or five-day follow-up was not queued';
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  perform public.respond_room_activity_nudge(v_nudge, 'all_good');
  if not exists (
    select 1 from public.room_activity_nudges
    where id = v_nudge and response = 'all_good' and responded_by = v_educator
  ) then raise exception 'FAIL: assigned room educator could not reply to the nudge'; end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  begin
    perform public.create_room_activity_nudge(v_room, 'nudge');
    raise exception 'FAIL: parent sent a room nudge';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.send_staff_credential_reminder(v_credential, false);
    raise exception 'FAIL: parent sent a credential reminder';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

rollback;
select 'PASS: Group 9 room nudges, educator replies, credential follow-ups and parent boundaries are enforced' as result;
