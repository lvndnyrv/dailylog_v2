-- Group 19: admins with medication edit access can create authorizations.
-- Updates were already covered by the P0 RBAC migration, but inserts were
-- inadvertently left parent-only in the baseline policy set.
drop policy if exists "permitted staff create medication auths"
  on medication_authorizations;
create policy "permitted staff create medication auths"
  on medication_authorizations
  for insert
  with check (
    has_permission('medications', 'edit')
    and can_write_child(child_id)
    and daycare_id = get_my_daycare_id()
  );

-- The shared trigger also runs for child_pickups, whose row type has no
-- used_at/used_by fields. Keep those field references inside a table-specific
-- branch so pickup inserts, edits, and archival remain usable.
create or replace function enforce_child_admin_mutation()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'child_invite_codes' then
    if tg_op = 'UPDATE'
       and old.used_at is null and new.used_at is not null and new.used_by = auth.uid() then
      return new;
    end if;
  end if;
  if not has_permission('children', 'edit') then
    raise exception 'Children edit permission required';
  end if;
  return coalesce(new, old);
end;
$$;
