-- Parent-created pickup passes must not elevate a pending pickup request.
-- Check at issuance, display, and consumption because approval may change
-- during the pass's short lifetime.
create function public.enforce_pickup_approval_on_pass_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pickup_id is not null and not exists (
    select 1 from public.child_pickups pickup
     where pickup.id = new.pickup_id and pickup.child_id = new.child_id
       and pickup.daycare_id = new.daycare_id
       and pickup.archived_at is null and pickup.approval_status = 'approved'
  ) then raise exception 'This pickup person is not approved'; end if;
  return new;
end;
$$;
create trigger enforce_pickup_approval_on_pass_insert
  before insert on public.pickup_passes
  for each row execute function public.enforce_pickup_approval_on_pass_insert();

create or replace function public.enforce_pickup_identity_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.used_at is null and new.used_at is not null then
    if new.pickup_id is not null and not exists (
      select 1 from public.child_pickups pickup
       where pickup.id = new.pickup_id and pickup.child_id = new.child_id
         and pickup.daycare_id = new.daycare_id
         and pickup.archived_at is null and pickup.approval_status = 'approved'
    ) then raise exception 'This pickup person is no longer approved'; end if;
    if public.pickup_needs_identity_check(new.daycare_id, new.pickup_id)
       and not exists (
         select 1 from public.pickup_identity_checks checked
          where checked.pass_id = new.id and checked.pickup_id = new.pickup_id
            and checked.checked_by = new.used_by
       ) then
      raise exception 'Check this new pickup person''s photo ID before checkout';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.get_mobile_pickup_id_check_requirement(p_pass_id uuid)
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
  if v_pass.pickup_id is not null and not exists (
    select 1 from public.child_pickups pickup
     where pickup.id = v_pass.pickup_id and pickup.child_id = v_pass.child_id
       and pickup.daycare_id = v_pass.daycare_id
       and pickup.archived_at is null and pickup.approval_status = 'approved'
  ) then raise exception 'This pickup person is no longer approved'; end if;
  return public.pickup_needs_identity_check(v_pass.daycare_id, v_pass.pickup_id);
end;
$$;

notify pgrst, 'reload schema';
