-- A room nudge is an educator check-in, not a center-wide daily-log notice.
-- The rooms permission aliases daily_logs, which educators have globally;
-- room membership must be checked separately for this private exchange.
drop policy if exists "staff read center room nudges" on public.room_activity_nudges;
create policy "staff read center room nudges" on public.room_activity_nudges
  for select using (
    daycare_id = public.get_my_daycare_id()
    and (
      (public.get_my_role() in ('owner_admin', 'admin')
        and public.has_permission('rooms', 'view'))
      or (public.get_my_role() = 'educator'
        and exists (
          select 1 from public.staff_members member
           where member.profile_id = auth.uid()
             and member.daycare_id = public.get_my_daycare_id()
             and member.status = 'active'
             and member.archived_at is null
        )
        and classroom_id in (select public.my_classroom_ids()))
    )
  );

-- A floater covering the room now also receives the nudge, rather than
-- depending on a permanently assigned educator noticing it first.
alter function public.create_room_activity_nudge(uuid, text)
  rename to _create_room_activity_nudge_with_home_recipients;
revoke all on function public._create_room_activity_nudge_with_home_recipients(uuid, text)
  from public, anon, authenticated, service_role;

create function public.create_room_activity_nudge(
  p_classroom_id uuid, p_mode text default 'nudge'
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  result jsonb;
  nudge_id uuid;
  nudge_message text;
  recipient uuid;
  added integer := 0;
begin
  result := public._create_room_activity_nudge_with_home_recipients(p_classroom_id, p_mode);
  if p_mode <> 'nudge' then return result; end if;
  nudge_id := (result ->> 'id')::uuid;
  select message into nudge_message
    from public.room_activity_nudges where id = nudge_id;

  for recipient in
    select distinct member.profile_id
      from public.room_coverage_assignments coverage
      join public.staff_members member on member.id = coverage.staff_member_id
      join public.profiles profile on profile.id = member.profile_id
     where coverage.classroom_id = p_classroom_id
       and coverage.daycare_id = public.get_my_daycare_id()
       and coverage.status = 'accepted'
       and coverage.starts_at <= now() and coverage.ends_at > now()
       and member.status = 'active' and member.archived_at is null
       and profile.role = 'educator' and profile.archived_at is null
       and not exists (
         select 1 from public.notifications notification
          where notification.profile_id = member.profile_id
            and notification.kind = 'room_activity_nudge'
            and notification.payload ->> 'nudgeId' = nudge_id::text
       )
  loop
    insert into public.notifications(daycare_id, profile_id, kind, title, body, payload)
    values(public.get_my_daycare_id(), recipient, 'room_activity_nudge',
      'Front office check-in', nudge_message,
      jsonb_build_object('type','room_activity_nudge','screen','RoomRatios',
        'roomId',p_classroom_id,'nudgeId',nudge_id));
    insert into public.notification_outbox(
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    ) values(public.get_my_daycare_id(), recipient, 'push', 'room_activity_nudge',
      'Front office check-in', nudge_message,
      jsonb_build_object('type','room_activity_nudge','screen','RoomRatios',
        'roomId',p_classroom_id,'nudgeId',nudge_id),
      'room-activity-nudge:' || nudge_id::text)
    on conflict do nothing;
    added := added + 1;
  end loop;
  return jsonb_set(result, '{queued}',
    to_jsonb(coalesce((result ->> 'queued')::integer, 0) + added));
end;
$$;

revoke all on function public.create_room_activity_nudge(uuid, text)
  from public, anon;
grant execute on function public.create_room_activity_nudge(uuid, text)
  to authenticated;

-- Keep the existing transactional reply implementation, but require a live
-- educator account before entering it. The inner function still checks the
-- open nudge and current room membership under its row lock.
alter function public.respond_room_activity_nudge(uuid, text)
  rename to _respond_room_activity_nudge_for_educator;
revoke all on function public._respond_room_activity_nudge_for_educator(uuid, text)
  from public, anon, authenticated, service_role;

create function public.respond_room_activity_nudge(p_nudge_id uuid, p_response text)
returns public.room_activity_nudges
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.get_my_role() <> 'educator'
     or not exists (
       select 1 from public.profiles profile
       join public.staff_members member on member.profile_id = profile.id
       where profile.id = auth.uid()
         and profile.archived_at is null
         and member.daycare_id = profile.daycare_id
         and member.status = 'active'
         and member.archived_at is null
     ) then
    raise exception 'Active educator account required';
  end if;
  return public._respond_room_activity_nudge_for_educator(p_nudge_id, p_response);
end;
$$;

revoke all on function public.respond_room_activity_nudge(uuid, text)
  from public, anon;
grant execute on function public.respond_room_activity_nudge(uuid, text)
  to authenticated;
