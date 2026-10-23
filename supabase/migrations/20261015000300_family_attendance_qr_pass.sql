-- A family attendance credential is separate from the educator-verified pickup
-- pass. Only its hash is stored; the displayed QR expires after two minutes.
create table public.family_attendance_passes (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  pickup_id uuid references public.child_pickups(id) on delete set null,
  presenter_name text not null,
  token_hash bytea not null unique,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index family_attendance_passes_active_child_idx
  on public.family_attendance_passes(child_id, created_by, expires_at)
  where used_at is null and revoked_at is null;
alter table public.family_attendance_passes enable row level security;
revoke all on public.family_attendance_passes from public, anon, authenticated;

create function public.create_family_attendance_pass(
  p_child_id uuid, p_pickup_id uuid default null
)
returns table(qr_payload text, expires_at timestamptz, presenter_name text,
  child_name text, room_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_child public.children%rowtype;
  v_presenter text;
  v_token text;
  v_expires timestamptz := now() + interval '2 minutes';
  v_today date;
begin
  if auth.uid() is null or not exists (
    select 1 from public.parent_children link
     where link.parent_id = auth.uid()
       and link.child_id = p_child_id and link.pickup_authorized
  ) then raise exception 'Authorized parent access required'; end if;
  select * into v_child from public.children child
   where child.id = p_child_id and child.archived_at is null;
  if not found then raise exception 'Child unavailable'; end if;
  v_today := (now() at time zone coalesce(
    (select center.timezone from public.daycares center where center.id = v_child.daycare_id),
    'UTC'))::date;
  if v_child.enrolled_on is not null and v_today < v_child.enrolled_on then
    raise exception 'Check-in becomes available on the enrollment start date';
  end if;
  if p_pickup_id is null then
    select profile.full_name into v_presenter from public.profiles profile
     where profile.id = auth.uid() and profile.archived_at is null;
  else
    select pickup.full_name into v_presenter from public.child_pickups pickup
     where pickup.id = p_pickup_id and pickup.child_id = p_child_id
       and pickup.daycare_id = v_child.daycare_id
       and pickup.archived_at is null and pickup.approval_status = 'approved';
  end if;
  if nullif(btrim(v_presenter), '') is null then
    raise exception 'That adult is not approved for this child';
  end if;

  perform public.assert_rate_limit('family_attendance_pass', 30, 3600, p_child_id::text);
  perform pg_advisory_xact_lock(hashtextextended(
    'family-pass:' || auth.uid()::text || ':' || p_child_id::text, 0));
  update public.family_attendance_passes pass set revoked_at = now()
   where pass.child_id = p_child_id and pass.created_by = auth.uid()
     and pass.used_at is null and pass.revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.family_attendance_passes (
    daycare_id, child_id, pickup_id, presenter_name, token_hash,
    created_by, expires_at
  ) values (
    v_child.daycare_id, p_child_id, p_pickup_id, v_presenter,
    extensions.digest(v_token, 'sha256'), auth.uid(), v_expires
  );
  return query select 'DL-ATT-1:' || v_token, v_expires, v_presenter,
    v_child.first_name || ' ' || v_child.last_name,
    (select room.name from public.classrooms room where room.id = v_child.classroom_id);
end;
$$;

create function public.redeem_family_attendance_pass(p_qr_payload text)
returns table(direction text, child_name text, presenter_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_pass public.family_attendance_passes%rowtype;
  v_record public.attendance_records%rowtype;
  v_today date := public.center_today();
  v_child public.children%rowtype;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit') then
    raise exception 'Staff attendance permission required';
  end if;
  perform public.assert_rate_limit('family_attendance_scan', 30, 60,
    public.get_my_daycare_id()::text);
  if p_qr_payload is null or p_qr_payload !~ '^DL-ATT-1:[0-9a-f]{64}$' then
    raise exception 'Invalid attendance pass';
  end if;
  select * into v_pass from public.family_attendance_passes pass
   where pass.token_hash = extensions.digest(substring(p_qr_payload from 10), 'sha256')
     and pass.daycare_id = public.get_my_daycare_id()
   for update;
  if not found or v_pass.used_at is not null or v_pass.revoked_at is not null
     or v_pass.expires_at <= now() then
    raise exception 'Attendance pass expired or already used';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'kiosk:' || v_pass.child_id::text || ':' || v_today::text, 0));
  select * into v_child from public.children child
   where child.id = v_pass.child_id and child.daycare_id = v_pass.daycare_id
     and child.archived_at is null;
  if not found then raise exception 'Child unavailable'; end if;
  if v_child.enrolled_on is not null and v_today < v_child.enrolled_on then
    raise exception 'Check-in becomes available on the enrollment start date';
  end if;
  if v_pass.pickup_id is not null and not exists (
    select 1 from public.child_pickups pickup
     where pickup.id = v_pass.pickup_id and pickup.child_id = v_pass.child_id
       and pickup.archived_at is null and pickup.approval_status = 'approved'
  ) then raise exception 'This adult is no longer approved'; end if;
  if not exists (
    select 1 from public.parent_children link
     where link.parent_id = v_pass.created_by and link.child_id = v_pass.child_id
       and link.pickup_authorized
  ) then raise exception 'This family pass is no longer authorized'; end if;

  select * into v_record from public.attendance_records attendance
   where attendance.child_id = v_pass.child_id and attendance.date = v_today
   for update;
  if v_record.checked_out_at is not null then
    raise exception 'This child was already checked out today; ask staff to review the record';
  end if;
  if v_record.id is null or v_record.checked_in_at is null then
    insert into public.attendance_records (
      daycare_id, child_id, date, checked_in_at, checked_in_by,
      method, status, dropped_off_by
    ) values (
      v_pass.daycare_id, v_pass.child_id, v_today, now(), auth.uid(),
      'kiosk', 'present', v_pass.presenter_name
    ) on conflict (child_id, date) do update set
      checked_in_at = now(), checked_in_by = auth.uid(),
      checked_out_at = null, checked_out_by = null, picked_up_by = null,
      method = 'kiosk', status = 'present', dropped_off_by = v_pass.presenter_name;
    direction := 'checked_in';
  else
    update public.attendance_records set checked_out_at = now(),
      checked_out_by = auth.uid(), picked_up_by = v_pass.presenter_name,
      method = 'kiosk' where id = v_record.id;
    direction := 'checked_out';
  end if;
  update public.family_attendance_passes set used_at = now() where id = v_pass.id;
  child_name := v_child.first_name || ' ' || v_child.last_name;
  presenter_name := v_pass.presenter_name;
  return next;
end;
$$;

revoke all on function public.create_family_attendance_pass(uuid,uuid) from public, anon;
revoke all on function public.redeem_family_attendance_pass(text) from public, anon;
grant execute on function public.create_family_attendance_pass(uuid,uuid) to authenticated;
grant execute on function public.redeem_family_attendance_pass(text) to authenticated;
notify pgrst, 'reload schema';
