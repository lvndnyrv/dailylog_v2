-- A live room combination gives both room teams access to the source-room
-- check-in. Notify the educators actually supervising that operating group,
-- while preserving accepted direct-coverage recipients and deduplicating the
-- original permanent-assignment notifications.
create or replace function public.create_room_activity_nudge(
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
  center_id uuid := public.get_my_daycare_id();
  added integer := 0;
begin
  result := public._create_room_activity_nudge_with_home_recipients(p_classroom_id, p_mode);
  if p_mode <> 'nudge' then return result; end if;
  nudge_id := (result ->> 'id')::uuid;
  select message into nudge_message
    from public.room_activity_nudges where id = nudge_id;

  for recipient in
    select distinct candidate.profile_id
      from (
        select member.profile_id
          from public.room_coverage_assignments coverage
          join public.staff_members member on member.id = coverage.staff_member_id
          join public.profiles profile on profile.id = member.profile_id
         where coverage.classroom_id = p_classroom_id
           and coverage.daycare_id = center_id
           and coverage.status = 'accepted'
           and coverage.starts_at <= now() and coverage.ends_at > now()
           and member.status = 'active' and member.archived_at is null
           and profile.role = 'educator' and profile.archived_at is null
        union
        select presence.profile_id
          from public._room_staff_presence(center_id) presence
         where exists (select 1 from public._active_room_combination(p_classroom_id))
           and public._operating_room_id(presence.effective_classroom_id)
               = public._operating_room_id(p_classroom_id)
      ) candidate
     where not exists (
       select 1 from public.notifications notification
        where notification.profile_id = candidate.profile_id
          and notification.kind = 'room_activity_nudge'
          and notification.payload ->> 'nudgeId' = nudge_id::text
     )
  loop
    insert into public.notifications(daycare_id, profile_id, kind, title, body, payload)
    values(center_id, recipient, 'room_activity_nudge',
      'Front office check-in', nudge_message,
      jsonb_build_object('type','room_activity_nudge','screen','RoomRatios',
        'roomId',p_classroom_id,'nudgeId',nudge_id));
    insert into public.notification_outbox(
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    ) values(center_id, recipient, 'push', 'room_activity_nudge',
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
