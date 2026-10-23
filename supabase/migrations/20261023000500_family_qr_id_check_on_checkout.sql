-- The family QR pass is used for either arrival or departure. New approved
-- pickup people may check a child in; the ID requirement applies only when
-- that same pass is consumed to release a checked-in child.
create or replace function public.enforce_family_pass_pickup_identity_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.used_at is null and new.used_at is not null
     and public.pickup_needs_identity_check(new.daycare_id, new.pickup_id)
     and exists (
       select 1 from public.attendance_records attendance
        where attendance.child_id = new.child_id
          and attendance.date = public.center_today()
          and attendance.checked_out_at is not null
     ) then
    raise exception 'New pickup people need a staff ID check. Use the verified pickup pass';
  end if;
  return new;
end;
$$;
