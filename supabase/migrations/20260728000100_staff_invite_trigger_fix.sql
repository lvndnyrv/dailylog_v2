-- ============================================================================
-- DailyLog — staff invite acceptance: table-safe RBAC trigger
-- ============================================================================
-- The shared staff mutation trigger previously referenced NEW.profile_id while
-- running for staff_invites. PostgreSQL resolves that record field even though
-- the preceding table-name condition is false, so invite_staff failed with:
--   record "new" has no field "profile_id"
-- Keep each table's record fields inside its own branch.

create or replace function enforce_staff_admin_mutation()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'staff_invites' then
    if tg_op = 'UPDATE'
       and old.accepted_at is null
       and new.accepted_by = auth.uid()
       and new.accepted_at is not null then
      return new;
    end if;
  elsif tg_table_name = 'staff_members' then
    if tg_op = 'INSERT' and new.profile_id = auth.uid() then
      return new;
    end if;
    if tg_op = 'UPDATE'
       and old.profile_id = auth.uid()
       and new.profile_id = auth.uid() then
      return new;
    end if;
  elsif tg_table_name = 'educator_classrooms' then
    if tg_op = 'INSERT' and new.educator_id = auth.uid() then
      return new;
    end if;
  end if;

  if not has_permission('staff', 'edit') then
    raise exception 'Staff edit permission required';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
