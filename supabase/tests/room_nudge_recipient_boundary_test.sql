-- Rollback-only Group 7/9 room-nudge recipient and reply boundary.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role',
      case when p_role = 'postgres' then 'service_role' else p_role end)::text, true);
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  center_id uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  infant_educator uuid := '00000000-0000-4000-a000-000000000003';
  toddler_educator uuid := '00000000-0000-4000-a000-000000000004';
  covering_educator uuid := '00000000-0000-4000-a000-000000000006';
  infant_room uuid := '20000000-0000-4000-a000-000000000001';
  toddler_room uuid := '20000000-0000-4000-a000-000000000002';
  infant_nudge uuid;
  toddler_nudge uuid;
  floater_nudge uuid;
  member_id uuid;
  denied boolean;
begin
  perform pg_temp.impersonate('authenticated', owner_id);
  infant_nudge := (public.create_room_activity_nudge(infant_room, 'nudge')->>'id')::uuid;
  toddler_nudge := (public.create_room_activity_nudge(toddler_room, 'nudge')->>'id')::uuid;

  perform pg_temp.impersonate('authenticated', infant_educator);
  if not exists(select 1 from public.room_activity_nudges where id = infant_nudge)
     or exists(select 1 from public.room_activity_nudges where id = toddler_nudge) then
    raise exception 'FAIL: Infant educator can read another room nudge or lost their own';
  end if;
  denied := false;
  begin
    perform public.respond_room_activity_nudge(toddler_nudge, 'all_good');
  exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: unrelated educator replied to Toddler nudge'; end if;

  perform pg_temp.impersonate('authenticated', owner_id);
  denied := false;
  begin
    perform public.respond_room_activity_nudge(infant_nudge, 'all_good');
  exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: administrator replied as room educator'; end if;

  perform pg_temp.impersonate('postgres');
  select id into member_id from public.staff_members where profile_id = covering_educator;
  insert into public.room_coverage_assignments(
    daycare_id, classroom_id, staff_member_id, starts_at, ends_at, status, notes
  ) values(center_id, infant_room, member_id, now() - interval '5 minutes',
    now() + interval '55 minutes', 'accepted', 'Rollback-only nudge coverage test');

  perform pg_temp.impersonate('authenticated', owner_id);
  floater_nudge := (public.create_room_activity_nudge(infant_room, 'nudge')->>'id')::uuid;
  perform pg_temp.impersonate('postgres');
  if not exists(select 1 from public.notifications
    where profile_id = covering_educator and kind = 'room_activity_nudge'
      and payload->>'nudgeId' = floater_nudge::text)
     or not exists(select 1 from public.notification_outbox
    where recipient_id = covering_educator and kind = 'room_activity_nudge'
      and payload->>'nudgeId' = floater_nudge::text) then
    raise exception 'FAIL: active floater was not notified (notifications %, outbox %)',
      (select count(*) from public.notifications where profile_id = covering_educator and kind = 'room_activity_nudge' and payload->>'nudgeId' = floater_nudge::text),
      (select count(*) from public.notification_outbox where recipient_id = covering_educator and kind = 'room_activity_nudge' and payload->>'nudgeId' = floater_nudge::text);
  end if;

  perform pg_temp.impersonate('authenticated', covering_educator);
  if not exists(select 1 from public.room_activity_nudges where id = floater_nudge) then
    raise exception 'FAIL: active coverage educator cannot read host-room nudge';
  end if;
  perform public.respond_room_activity_nudge(floater_nudge, 'all_good');
  if not exists(select 1 from public.room_activity_nudges
    where id = floater_nudge and responded_by = covering_educator) then
    raise exception 'FAIL: active coverage educator could not respond';
  end if;

  raise notice 'PASS: room nudges are scoped to educators with current room access, including accepted coverage';
end $$;

rollback;
select 'PASS: room nudge reads, replies and active-coverage delivery are room-scoped' as result;
