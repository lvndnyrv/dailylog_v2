-- ==========================================================================
-- Parent mobile Group 22 — Account / Me, notification preferences,
-- co-guardian invitations, and privacy/data requests.
-- ==========================================================================

alter table public.notification_preferences
  drop constraint if exists notification_preferences_kind_check;

alter table public.notification_preferences
  add constraint notification_preferences_kind_check check (kind in (
    'ratio_alert',
    'incident_report',
    'cert_expiry',
    'overdue_billing',
    'new_device_sign_in',
    'waitlist_enrollment',
    'parent_attendance',
    'parent_moments',
    'parent_routines',
    'parent_messages',
    'parent_announcements',
    'parent_billing'
  ));

create table if not exists public.parent_data_requests (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null check (request_type in ('export', 'deletion')),
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'ready', 'completed', 'cancelled')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists parent_data_requests_one_open_idx
  on public.parent_data_requests (profile_id, request_type)
  where status in ('requested', 'processing');

create index if not exists parent_data_requests_daycare_status_idx
  on public.parent_data_requests (daycare_id, status, requested_at desc);

drop trigger if exists parent_data_requests_updated_at
  on public.parent_data_requests;
create trigger parent_data_requests_updated_at
  before update on public.parent_data_requests
  for each row execute function public.update_updated_at();

alter table public.parent_data_requests enable row level security;

drop policy if exists "parents read own data requests"
  on public.parent_data_requests;
create policy "parents read own data requests"
  on public.parent_data_requests for select
  using (profile_id = auth.uid());

drop policy if exists "admins manage center data requests"
  on public.parent_data_requests;
create policy "admins manage center data requests"
  on public.parent_data_requests for all
  using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create or replace function public.get_parent_account_hub()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_children jsonb := '[]'::jsonb;
  v_request jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;

  if v_profile.id is null then
    raise exception 'A signed-in parent account is required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', child.id,
      'first_name', child.first_name,
      'last_name', child.last_name,
      'date_of_birth', child.date_of_birth,
      'photo_url', child.photo_url,
      'classroom_name', child.classroom_name,
      'is_primary', child.is_primary,
      'guardians', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', guardian.id,
          'full_name', guardian.full_name,
          'email', guardian.email,
          'relationship', link.relationship,
          'is_primary', link.is_primary,
          'is_current_user', guardian.id = auth.uid()
        ) order by link.is_primary desc, guardian.full_name)
        from public.parent_children link
        join public.profiles guardian on guardian.id = link.parent_id
        where link.child_id = child.id and guardian.archived_at is null
      ), '[]'::jsonb),
      'pending_invites', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', invite.id,
          'email', invite.email,
          'relationship', invite.relationship,
          'created_at', invite.created_at,
          'expires_at', invite.expires_at
        ) order by invite.created_at desc)
        from public.child_invite_codes invite
        where invite.child_id = child.id
          and invite.created_by = auth.uid()
          and invite.used_at is null
          and (invite.expires_at is null or invite.expires_at > now())
      ), '[]'::jsonb)
    ) order by child.first_name, child.last_name
  ), '[]'::jsonb)
  into v_children
  from (
    select c.id, c.first_name, c.last_name, c.date_of_birth, c.photo_url,
           room.name as classroom_name, mine.is_primary
    from public.parent_children mine
    join public.children c on c.id = mine.child_id and c.archived_at is null
    left join public.classrooms room on room.id = c.classroom_id
    where mine.parent_id = auth.uid()
  ) child;

  select jsonb_build_object(
    'id', request.id,
    'request_type', request.request_type,
    'status', request.status,
    'requested_at', request.requested_at,
    'completed_at', request.completed_at
  )
  into v_request
  from public.parent_data_requests request
  where request.profile_id = auth.uid()
  order by request.requested_at desc
  limit 1;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'full_name', v_profile.full_name,
      'display_name', v_profile.display_name,
      'email', v_profile.email,
      'avatar_url', v_profile.avatar_url
    ),
    'children', v_children,
    'latest_data_request', v_request
  );
end;
$$;

create or replace function public.get_parent_notification_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_preferences jsonb;
  v_delivery public.notification_delivery_settings%rowtype;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;

  if v_profile.id is null or v_profile.daycare_id is null then
    raise exception 'A linked parent account is required';
  end if;

  insert into public.notification_preferences (
    profile_id, daycare_id, kind, in_app, push, email
  )
  select v_profile.id, v_profile.daycare_id, seed.kind, true, seed.enabled, false
  from (values
    ('parent_attendance', true),
    ('parent_moments', true),
    ('parent_routines', false),
    ('parent_messages', true),
    ('incident_report', true),
    ('parent_announcements', true),
    ('parent_billing', true)
  ) as seed(kind, enabled)
  on conflict (profile_id, kind) do nothing;

  insert into public.notification_delivery_settings (
    profile_id, daycare_id, quiet_hours_enabled,
    quiet_hours_start, quiet_hours_end, email_mode
  ) values (
    v_profile.id, v_profile.daycare_id, true,
    time '20:00', time '07:00', 'off'
  )
  on conflict (profile_id) do nothing;

  -- Incident reports are a safety notification and cannot be muted.
  update public.notification_preferences
  set in_app = true, push = true
  where profile_id = v_profile.id and kind = 'incident_report';

  select coalesce(jsonb_object_agg(pref.kind, pref.push), '{}'::jsonb)
  into v_preferences
  from public.notification_preferences pref
  where pref.profile_id = v_profile.id
    and pref.kind in (
      'parent_attendance', 'parent_moments', 'parent_routines',
      'parent_messages', 'incident_report', 'parent_announcements',
      'parent_billing'
    );

  select * into v_delivery
  from public.notification_delivery_settings
  where profile_id = v_profile.id;

  return jsonb_build_object(
    'preferences', v_preferences,
    'quiet_hours_enabled', v_delivery.quiet_hours_enabled,
    'quiet_hours_start', to_char(v_delivery.quiet_hours_start, 'HH24:MI'),
    'quiet_hours_end', to_char(v_delivery.quiet_hours_end, 'HH24:MI')
  );
end;
$$;

create or replace function public.set_parent_notification_preference(
  p_kind text,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid;
  v_enabled boolean;
begin
  select daycare_id into v_daycare
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;

  if v_daycare is null then
    raise exception 'A linked parent account is required';
  end if;
  if p_kind not in (
    'parent_attendance', 'parent_moments', 'parent_routines',
    'parent_messages', 'incident_report', 'parent_announcements',
    'parent_billing'
  ) then
    raise exception 'Unsupported parent notification preference';
  end if;

  v_enabled := case when p_kind = 'incident_report' then true else p_enabled end;
  insert into public.notification_preferences (
    profile_id, daycare_id, kind, in_app, push, email
  ) values (auth.uid(), v_daycare, p_kind, true, v_enabled, false)
  on conflict (profile_id, kind) do update
    set push = excluded.push, in_app = true, updated_at = now();

  return v_enabled;
end;
$$;

create or replace function public.set_parent_quiet_hours(
  p_enabled boolean,
  p_start time default time '20:00',
  p_end time default time '07:00'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid;
begin
  select daycare_id into v_daycare
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;

  if v_daycare is null then
    raise exception 'A linked parent account is required';
  end if;

  insert into public.notification_delivery_settings (
    profile_id, daycare_id, quiet_hours_enabled,
    quiet_hours_start, quiet_hours_end, email_mode
  ) values (auth.uid(), v_daycare, p_enabled, p_start, p_end, 'off')
  on conflict (profile_id) do update
    set quiet_hours_enabled = excluded.quiet_hours_enabled,
        quiet_hours_start = excluded.quiet_hours_start,
        quiet_hours_end = excluded.quiet_hours_end,
        updated_at = now();

  return jsonb_build_object(
    'quiet_hours_enabled', p_enabled,
    'quiet_hours_start', to_char(p_start, 'HH24:MI'),
    'quiet_hours_end', to_char(p_end, 'HH24:MI')
  );
end;
$$;

create or replace function public.create_parent_co_guardian_invite(
  p_child_id uuid,
  p_email text,
  p_relationship text default 'Parent/guardian'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid;
  v_email text := lower(btrim(p_email));
  v_code text;
  v_invite public.child_invite_codes%rowtype;
begin
  if auth.uid() is null or get_my_role() <> 'parent' then
    raise exception 'A signed-in parent account is required';
  end if;
  perform public.assert_rate_limit('parent_guardian_invite', 8, 3600, p_child_id::text);

  select child.daycare_id into v_daycare
  from public.children child
  join public.parent_children mine
    on mine.child_id = child.id and mine.parent_id = auth.uid()
  where child.id = p_child_id and child.archived_at is null;

  if v_daycare is null then
    raise exception 'You can only invite guardians for your linked children';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'Enter a valid email address';
  end if;
  if exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and lower(profile.email) = v_email
  ) then
    raise exception 'You are already linked to this child';
  end if;
  if exists (
    select 1
    from public.parent_children link
    join public.profiles guardian on guardian.id = link.parent_id
    where link.child_id = p_child_id and lower(guardian.email) = v_email
  ) then
    raise exception 'This guardian is already linked to the child';
  end if;

  delete from public.child_invite_codes
  where child_id = p_child_id
    and lower(email) = v_email
    and created_by = auth.uid()
    and used_at is null;

  v_code := public.generate_invite_code();
  insert into public.child_invite_codes (
    daycare_id, child_id, code, email, relationship,
    created_by, expires_at
  ) values (
    v_daycare, p_child_id, v_code, v_email,
    coalesce(nullif(btrim(p_relationship), ''), 'Parent/guardian'),
    auth.uid(), now() + interval '14 days'
  ) returning * into v_invite;

  return jsonb_build_object(
    'id', v_invite.id,
    'email', v_invite.email,
    'relationship', v_invite.relationship,
    'code', v_invite.code,
    'expires_at', v_invite.expires_at
  );
end;
$$;

create or replace function public.request_parent_data_action(p_request_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_request public.parent_data_requests%rowtype;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;

  if v_profile.id is null or v_profile.daycare_id is null then
    raise exception 'A linked parent account is required';
  end if;
  if p_request_type not in ('export', 'deletion') then
    raise exception 'Unsupported data request';
  end if;
  perform public.assert_rate_limit('parent_data_request', 4, 86400, p_request_type);

  select * into v_request
  from public.parent_data_requests request
  where request.profile_id = auth.uid()
    and request.request_type = p_request_type
    and request.status in ('requested', 'processing')
  order by request.requested_at desc
  limit 1;

  if v_request.id is null then
    insert into public.parent_data_requests (
      daycare_id, profile_id, request_type
    ) values (
      v_profile.daycare_id, v_profile.id, p_request_type
    ) returning * into v_request;
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'request_type', v_request.request_type,
    'status', v_request.status,
    'requested_at', v_request.requested_at,
    'completed_at', v_request.completed_at
  );
end;
$$;

revoke all on function public.get_parent_account_hub() from public;
revoke all on function public.get_parent_notification_settings() from public;
revoke all on function public.set_parent_notification_preference(text, boolean) from public;
revoke all on function public.set_parent_quiet_hours(boolean, time, time) from public;
revoke all on function public.create_parent_co_guardian_invite(uuid, text, text) from public;
revoke all on function public.request_parent_data_action(text) from public;

grant execute on function public.get_parent_account_hub() to authenticated;
grant execute on function public.get_parent_notification_settings() to authenticated;
grant execute on function public.set_parent_notification_preference(text, boolean) to authenticated;
grant execute on function public.set_parent_quiet_hours(boolean, time, time) to authenticated;
grant execute on function public.create_parent_co_guardian_invite(uuid, text, text) to authenticated;
grant execute on function public.request_parent_data_action(text) to authenticated;
