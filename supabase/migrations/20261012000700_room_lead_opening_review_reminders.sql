-- A future room lead is a designation, not a home-room assignment. Remind
-- permitted administrators when the room opens; never move staff in a worker.
create function public._can_review_room_lead_handoff(p_profile_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_role text;
  v_daycare uuid;
  v_role_permissions jsonb;
  v_override jsonb;
  v_area text;
  v_value text;
begin
  select profile.role, profile.daycare_id, center_role.permissions, override.permissions
    into v_role, v_daycare, v_role_permissions, v_override
    from public.profiles profile
    left join public.center_roles center_role
      on center_role.id = profile.center_role_id and center_role.daycare_id = profile.daycare_id
    left join public.staff_permission_overrides override
      on override.profile_id = profile.id and override.classroom_id is null
   where profile.id = p_profile_id and profile.archived_at is null;
  if v_role not in ('owner_admin', 'admin') then return false; end if;
  if v_role = 'owner_admin' then return true; end if;

  foreach v_area in array array['daily_logs', 'staff'] loop
    if exists (
      select 1 from public.staff_delegations delegation
       where delegation.delegate_profile_id = p_profile_id
         and delegation.daycare_id = v_daycare
         and delegation.starts_at <= now()
         and delegation.ends_at > now()
         and delegation.revoked_at is null
         and (delegation.access_level = 'full_admin' or v_area = any(delegation.areas))
    ) then continue; end if;
    v_value := v_override #>> array[v_area, 'edit'];
    if v_value is null then v_value := v_role_permissions #>> array[v_area, 'edit']; end if;
    if v_value = 'false' then return false; end if;
  end loop;
  return true;
end;
$$;

revoke all on function public._can_review_room_lead_handoff(uuid) from public, anon, authenticated;
grant execute on function public._can_review_room_lead_handoff(uuid) to service_role;

create function public.enqueue_room_lead_opening_reviews()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_room record;
  v_recipient record;
  v_key text;
  v_payload jsonb;
  v_title text;
  v_body text;
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;

  for v_room in
    select room.id, room.daycare_id, room.name, room.opens_on, room.lead_educator_id,
           lead.full_name lead_name, lead.classroom_id home_room_id
      from public.classrooms room
      join public.daycares center on center.id = room.daycare_id
      join public.profiles lead on lead.id = room.lead_educator_id
        and lead.daycare_id = room.daycare_id
        and lead.role = 'educator' and lead.archived_at is null
      join public.staff_members member on member.profile_id = lead.id
        and member.daycare_id = room.daycare_id
        and member.status = 'active' and member.archived_at is null
        and (member.ended_on is null or member.ended_on > (now() at time zone center.timezone)::date)
     where room.archived_at is null
       and room.opens_on is not null
       and room.opens_on between (now() at time zone center.timezone)::date - 7
                             and (now() at time zone center.timezone)::date
       and lead.classroom_id is distinct from room.id
     order by room.id
  loop
    v_key := 'room-lead-opening:' || v_room.id || ':' || v_room.lead_educator_id || ':' || v_room.opens_on;
    v_title := v_room.name || ' lead transfer needs review';
    v_body := coalesce(v_room.lead_name, 'The designated lead') ||
      ' still has another home room. Review schedules and confirm the transfer if appropriate.';
    v_payload := jsonb_build_object(
      'type', 'room_lead_handoff', 'screen', 'RoomRatios', 'roomId', v_room.id,
      'href', '/rooms/' || v_room.id || '#lead-handoff',
      'source', 'Rooms & ratios', 'action_label', 'Review lead transfer',
      'dedupeKey', v_key
    );

    for v_recipient in
      select profile.id
        from public.profiles profile
       where profile.daycare_id = v_room.daycare_id
         and profile.role in ('owner_admin', 'admin')
         and profile.archived_at is null
         and public._can_review_room_lead_handoff(profile.id)
    loop
      perform pg_advisory_xact_lock(hashtextextended(v_recipient.id::text || v_key, 0));
      if not exists (
        select 1 from public.notifications notice
         where notice.profile_id = v_recipient.id
           and notice.kind = 'room_lead_handoff'
           and notice.payload ->> 'dedupeKey' = v_key
      ) then
        insert into public.notifications(daycare_id, profile_id, kind, title, body, payload)
        values(v_room.daycare_id, v_recipient.id, 'room_lead_handoff', v_title, v_body, v_payload);
        v_count := v_count + 1;
      end if;
      insert into public.notification_outbox(
        daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
      ) values (
        v_room.daycare_id, v_recipient.id, 'push', 'room_lead_handoff',
        v_title, v_body, v_payload, v_key
      ) on conflict do nothing;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.enqueue_room_lead_opening_reviews() from public, anon, authenticated;
grant execute on function public.enqueue_room_lead_opening_reviews() to service_role;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'dailylog-room-lead-opening-reviews';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'dailylog-room-lead-opening-reviews',
    '15 * * * *',
    $cron$
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      select public.enqueue_room_lead_opening_reviews();
    $cron$
  );
end;
$$;
