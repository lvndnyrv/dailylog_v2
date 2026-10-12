-- Admin dashboard Group 9: traceable quiet-room nudges and credential reminders.

create table if not exists public.room_activity_nudges (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  sent_by uuid not null references public.profiles(id),
  mode text not null default 'nudge' check (mode in ('nudge', 'expected')),
  message text not null,
  snoozed_until timestamptz,
  responded_by uuid references public.profiles(id),
  response text check (response is null or response in ('all_good', 'will_log', 'send_help')),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists room_activity_nudges_room_created_idx
  on public.room_activity_nudges (classroom_id, created_at desc);

alter table public.room_activity_nudges enable row level security;

drop policy if exists "staff read center room nudges" on public.room_activity_nudges;
create policy "staff read center room nudges" on public.room_activity_nudges
  for select using (
    daycare_id = public.get_my_daycare_id()
    and (
      public.has_permission('rooms', 'view')
      or classroom_id in (select public.my_classroom_ids())
    )
  );

create or replace function public.create_room_activity_nudge(
  p_classroom_id uuid,
  p_mode text default 'nudge'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_room_name text;
  v_id uuid;
  v_message text;
  v_snoozed_until timestamptz;
  v_recipient uuid;
  v_queued integer := 0;
  v_payload jsonb;
begin
  if v_daycare is null or not public.has_permission('rooms', 'edit') then
    raise exception 'Rooms edit permission required';
  end if;
  if p_mode not in ('nudge', 'expected') then
    raise exception 'Unsupported room nudge mode';
  end if;

  select room.name into v_room_name
    from public.classrooms room
   where room.id = p_classroom_id
     and room.daycare_id = v_daycare
     and room.archived_at is null;
  if v_room_name is null then raise exception 'Room not found'; end if;

  v_message := case p_mode
    when 'expected' then 'Quiet activity is expected today.'
    else 'All good in ' || v_room_name || '? Haven''t seen a log recently — one tap is plenty.'
  end;
  v_snoozed_until := case when p_mode = 'expected' then now() + interval '3 hours' end;

  insert into public.room_activity_nudges (
    daycare_id, classroom_id, sent_by, mode, message, snoozed_until
  ) values (
    v_daycare, p_classroom_id, auth.uid(), p_mode, v_message, v_snoozed_until
  ) returning id into v_id;

  if p_mode = 'nudge' then
    v_payload := jsonb_build_object(
      'type', 'room_activity_nudge',
      'screen', 'RoomRatios',
      'roomId', p_classroom_id,
      'nudgeId', v_id
    );

    for v_recipient in
      select distinct recipient_id from (
        select assignment.educator_id as recipient_id
          from public.educator_classrooms assignment
         where assignment.classroom_id = p_classroom_id
        union
        select profile.id
          from public.profiles profile
         where profile.classroom_id = p_classroom_id
           and profile.role = 'educator'
      ) recipients
      join public.profiles profile on profile.id = recipients.recipient_id
     where profile.daycare_id = v_daycare and profile.archived_at is null
    loop
      insert into public.notifications (
        daycare_id, profile_id, kind, title, body, payload
      ) values (
        v_daycare, v_recipient, 'room_activity_nudge',
        'Front office check-in', v_message, v_payload
      );
      insert into public.notification_outbox (
        daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
      ) values (
        v_daycare, v_recipient, 'push', 'room_activity_nudge',
        'Front office check-in', v_message, v_payload,
        'room-activity-nudge:' || v_id::text
      ) on conflict do nothing;
      v_queued := v_queued + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'mode', p_mode,
    'queued', v_queued,
    'snoozedUntil', v_snoozed_until
  );
end;
$$;

create or replace function public.respond_room_activity_nudge(
  p_nudge_id uuid,
  p_response text
)
returns public.room_activity_nudges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nudge public.room_activity_nudges;
  v_responder text;
  v_admin uuid;
  v_room_name text;
  v_payload jsonb;
begin
  if p_response not in ('all_good', 'will_log', 'send_help') then
    raise exception 'Unsupported room response';
  end if;
  select nudge.* into v_nudge
    from public.room_activity_nudges nudge
   where nudge.id = p_nudge_id
     and nudge.mode = 'nudge'
     and nudge.response is null
     and nudge.daycare_id = public.get_my_daycare_id()
     and nudge.classroom_id in (select public.my_classroom_ids())
   for update;
  if v_nudge.id is null then raise exception 'Open room nudge not found'; end if;

  update public.room_activity_nudges
     set response = p_response, responded_by = auth.uid(), responded_at = now()
   where id = p_nudge_id
  returning * into v_nudge;

  select profile.full_name into v_responder from public.profiles profile where profile.id = auth.uid();
  select room.name into v_room_name from public.classrooms room where room.id = v_nudge.classroom_id;
  v_payload := jsonb_build_object(
    'type', 'room_activity_nudge_response',
    'screen', 'Dashboard',
    'roomId', v_nudge.classroom_id,
    'nudgeId', v_nudge.id,
    'response', p_response
  );

  for v_admin in
    select profile.id from public.profiles profile
     where profile.daycare_id = v_nudge.daycare_id
       and profile.archived_at is null
       and profile.role in ('owner_admin', 'admin')
  loop
    insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
    values (
      v_nudge.daycare_id, v_admin, 'room_activity_nudge_response',
      coalesce(v_room_name, 'Room') || ' replied',
      coalesce(v_responder, 'An educator') || ' responded: ' ||
        case p_response when 'all_good' then 'All good — at the park'
          when 'will_log' then 'Will log now' else 'Send help' end,
      v_payload
    );
  end loop;
  return v_nudge;
end;
$$;

create or replace function public.send_staff_credential_reminder(
  p_credential_id uuid,
  p_remind_again boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_credential public.staff_credentials;
  v_profile public.profiles;
  v_title text;
  v_body text;
  v_payload jsonb;
  v_now_key text := to_char(now(), 'YYYYMMDD');
  v_immediate integer := 0;
  v_follow_up integer := 0;
begin
  if v_daycare is null or not public.has_permission('staff', 'edit') then
    raise exception 'Staff edit permission required';
  end if;
  select credential.* into v_credential
    from public.staff_credentials credential
   where credential.id = p_credential_id
     and credential.daycare_id = v_daycare
     and credential.archived_at is null;
  if v_credential.id is null then raise exception 'Credential not found'; end if;
  select profile.* into v_profile
    from public.staff_members staff
    join public.profiles profile on profile.id = staff.profile_id
   where staff.id = v_credential.staff_member_id
     and staff.status = 'active'
     and staff.archived_at is null;
  if v_profile.id is null then raise exception 'Active staff profile not found'; end if;

  v_title := v_credential.name || ' renewal reminder';
  v_body := 'Hi ' || split_part(v_profile.full_name, ' ', 1) || ' — your ' ||
    v_credential.name || case when v_credential.expires_on is not null
      then ' expires ' || to_char(v_credential.expires_on, 'Mon FMDD') else ' is still missing' end ||
    '. Upload a photo of the new card in your app when it is ready.';
  v_payload := jsonb_build_object(
    'type', 'credential_reminder', 'screen', 'Credentials',
    'credentialId', v_credential.id, 'staffMemberId', v_credential.staff_member_id
  );

  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  values (v_daycare, v_profile.id, 'credential_reminder', v_title, v_body, v_payload);
  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  ) values (
    v_daycare, v_profile.id, 'push', 'credential_reminder', v_title, v_body, v_payload,
    'credential-reminder:' || v_credential.id::text || ':' || v_now_key
  ) on conflict do nothing;
  get diagnostics v_immediate = row_count;

  if v_profile.email is not null then
    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_daycare, lower(v_profile.email), 'email', 'credential_reminder', v_title, v_body, v_payload,
      'credential-reminder-email:' || v_credential.id::text || ':' || v_now_key
    ) on conflict do nothing;
  end if;

  if p_remind_again then
    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload,
      dedupe_key, available_at
    ) values (
      v_daycare, v_profile.id, 'push', 'credential_reminder', v_title, v_body, v_payload,
      'credential-reminder-follow-up:' || v_credential.id::text || ':' || v_now_key,
      now() + interval '5 days'
    ) on conflict do nothing;
    get diagnostics v_follow_up = row_count;
  end if;

  return jsonb_build_object(
    'sent', v_immediate > 0,
    'followUpScheduled', v_follow_up > 0,
    'recipient', v_profile.full_name
  );
end;
$$;

revoke all on function public.create_room_activity_nudge(uuid, text) from public, anon;
revoke all on function public.respond_room_activity_nudge(uuid, text) from public, anon;
revoke all on function public.send_staff_credential_reminder(uuid, boolean) from public, anon;
grant execute on function public.create_room_activity_nudge(uuid, text) to authenticated;
grant execute on function public.respond_room_activity_nudge(uuid, text) to authenticated;
grant execute on function public.send_staff_credential_reminder(uuid, boolean) to authenticated;

create or replace function public.enforce_notification_enqueue_permission()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_area text;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  v_area := case new.kind
    when 'announcement' then 'broadcasts'
    when 'incident' then 'incidents'
    when 'medication' then 'medications'
    when 'invoice' then 'billing'
    when 'invoice_reminder' then 'billing'
    when 'payment' then 'billing'
    when 'staff_invite' then 'staff'
    when 'credential_reminder' then 'staff'
    when 'room_activity_nudge' then 'rooms'
    when 'parent_invite' then 'children'
    else 'daily_logs'
  end;
  if not public.has_permission(v_area, 'edit') then
    raise exception '% edit permission required', v_area;
  end if;
  return new;
end;
$$;
