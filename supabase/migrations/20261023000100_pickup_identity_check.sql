-- A new, non-account pickup person needs a staff ID check before their first
-- completed hand-off when the center policy is enabled. Never store ID images
-- or numbers; retain only the staff attestation and the pass it applies to.
create table public.pickup_identity_checks (
  id uuid not null unique default gen_random_uuid(),
  pass_id uuid primary key references public.pickup_passes(id) on delete cascade,
  pickup_id uuid not null references public.child_pickups(id) on delete cascade,
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  checked_by uuid not null references public.profiles(id),
  checked_at timestamptz not null default now()
);
create index pickup_identity_checks_pickup_idx on public.pickup_identity_checks(pickup_id);
alter table public.pickup_identity_checks enable row level security;
revoke all on public.pickup_identity_checks from public, anon, authenticated;
create trigger audit_pickup_identity_checks
  after insert on public.pickup_identity_checks
  for each row execute function public.audit_write();

create function public.pickup_needs_identity_check(p_daycare_id uuid, p_pickup_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_pickup_id is not null
    and coalesce((select center.pickup_id_check_required from public.daycares center
                    where center.id = p_daycare_id), true)
    and not exists (
      select 1 from public.pickup_identity_checks checked
      join public.pickup_passes pass on pass.id = checked.pass_id
      where checked.pickup_id = p_pickup_id
        and checked.daycare_id = p_daycare_id
        and pass.used_at is not null
    );
$$;
revoke all on function public.pickup_needs_identity_check(uuid,uuid) from public, anon, authenticated;

create function public.get_mobile_pickup_id_check_requirement(p_pass_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_pass public.pickup_passes%rowtype;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit') then
    raise exception 'Attendance edit permission is required';
  end if;
  select * into v_pass from public.pickup_passes where id = p_pass_id;
  if not found or v_pass.daycare_id <> public.get_my_daycare_id()
     or v_pass.used_at is not null or v_pass.revoked_at is not null
     or v_pass.expires_at <= now() or not public.can_write_child(v_pass.child_id) then
    raise exception 'Pass is invalid, expired, or already used';
  end if;
  return public.pickup_needs_identity_check(v_pass.daycare_id, v_pass.pickup_id);
end;
$$;
revoke all on function public.get_mobile_pickup_id_check_requirement(uuid) from public, anon;
grant execute on function public.get_mobile_pickup_id_check_requirement(uuid) to authenticated;

create function public.attest_mobile_pickup_id_check(p_pass_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pass public.pickup_passes%rowtype;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit') then
    raise exception 'Attendance edit permission is required';
  end if;
  select * into v_pass from public.pickup_passes where id = p_pass_id for update;
  if not found or v_pass.daycare_id <> public.get_my_daycare_id()
     or v_pass.pickup_id is null or v_pass.used_at is not null
     or v_pass.revoked_at is not null or v_pass.expires_at <= now()
     or not public.can_write_child(v_pass.child_id) then
    raise exception 'Pass is invalid, expired, or already used';
  end if;
  if not exists (
    select 1 from public.child_pickups pickup
    where pickup.id = v_pass.pickup_id and pickup.child_id = v_pass.child_id
      and pickup.daycare_id = v_pass.daycare_id
      and pickup.archived_at is null and pickup.approval_status = 'approved'
  ) then raise exception 'This person is no longer approved for pickup'; end if;
  insert into public.pickup_identity_checks(pass_id, pickup_id, daycare_id, checked_by)
  values (v_pass.id, v_pass.pickup_id, v_pass.daycare_id, auth.uid())
  on conflict (pass_id) do nothing;
  if not exists (
    select 1 from public.pickup_identity_checks checked
    where checked.pass_id = v_pass.id and checked.checked_by = auth.uid()
  ) then raise exception 'Another staff member recorded this ID check'; end if;
end;
$$;
revoke all on function public.attest_mobile_pickup_id_check(uuid) from public, anon;
grant execute on function public.attest_mobile_pickup_id_check(uuid) to authenticated;

-- The checkout RPC updates attendance first, then consumes the pass. A trigger
-- here rejects the transaction atomically, including the late-pickup RPC.
create function public.enforce_pickup_identity_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.used_at is null and new.used_at is not null
     and public.pickup_needs_identity_check(new.daycare_id, new.pickup_id)
     and not exists (
       select 1 from public.pickup_identity_checks checked
       where checked.pass_id = new.id and checked.pickup_id = new.pickup_id
         and checked.checked_by = new.used_by
     ) then
    raise exception 'Check this new pickup person''s photo ID before checkout';
  end if;
  return new;
end;
$$;
create trigger enforce_pickup_identity_check
  before update of used_at on public.pickup_passes
  for each row execute function public.enforce_pickup_identity_check();

-- Self-service QR checkout has no ID-check step; require the supervised
-- verified hand-off for a new pickup person instead.
create function public.enforce_family_pass_pickup_identity_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.used_at is null and new.used_at is not null
     and public.pickup_needs_identity_check(new.daycare_id, new.pickup_id) then
    raise exception 'New pickup people need a staff ID check. Use the verified pickup pass';
  end if;
  return new;
end;
$$;
create trigger enforce_family_pass_pickup_identity_check
  before update of used_at on public.family_attendance_passes
  for each row execute function public.enforce_family_pass_pickup_identity_check();

-- The PIN kiosk identifies the pickup row directly. Block only checkout;
-- check-in remains available to a newly approved person.
create or replace function public.kiosk_check(p_child_id uuid, p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pickup public.child_pickups%rowtype;
  v_record public.attendance_records%rowtype;
  v_today date := public.center_today();
  v_enrolled_on date;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit') then
    raise exception 'Staff attendance permission required';
  end if;
  perform public.assert_rate_limit('kiosk_pin_redeem', 30, 60, public.get_my_daycare_id()::text);
  perform pg_advisory_xact_lock(hashtextextended(
    'kiosk:' || p_child_id::text || ':' || v_today::text, 0
  ));
  select child.enrolled_on into v_enrolled_on
    from public.children child
   where child.id = p_child_id and child.daycare_id = public.get_my_daycare_id()
     and child.archived_at is null;
  if not found then raise exception 'Child not found'; end if;
  if v_enrolled_on is not null and v_today < v_enrolled_on then
    raise exception 'Check-in becomes available on the enrollment start date';
  end if;
  select * into v_pickup from public.child_pickups
   where pin = btrim(p_pin) and child_id = p_child_id
     and archived_at is null and approval_status = 'approved'
     and daycare_id = public.get_my_daycare_id();
  if v_pickup.id is null then
    raise exception 'PIN does not match an approved pickup for this child';
  end if;
  select * into v_record from public.attendance_records
   where child_id = p_child_id and date = v_today for update;
  if v_record.checked_out_at is not null then
    raise exception 'This child was already checked out today; ask staff to review the attendance record';
  end if;
  if v_record.id is null or v_record.checked_in_at is null then
    insert into public.attendance_records (
      daycare_id, child_id, date, checked_in_at, checked_in_by,
      method, status, dropped_off_by
    ) values (
      v_pickup.daycare_id, p_child_id, v_today, now(), auth.uid(),
      'kiosk', 'present', v_pickup.full_name
    ) on conflict (child_id, date) do update
      set checked_in_at = now(), checked_in_by = auth.uid(),
          method = 'kiosk', status = 'present',
          dropped_off_by = v_pickup.full_name,
          checked_out_at = null, checked_out_by = null, picked_up_by = null;
    return 'checked_in';
  end if;
  if public.pickup_needs_identity_check(v_pickup.daycare_id, v_pickup.id) then
    raise exception 'New pickup people need a staff ID check. Use the verified pickup pass';
  end if;
  update public.attendance_records
     set checked_out_at = now(), checked_out_by = auth.uid(),
         picked_up_by = v_pickup.full_name, method = 'kiosk'
   where id = v_record.id;
  return 'checked_out';
end;
$$;

notify pgrst, 'reload schema';
