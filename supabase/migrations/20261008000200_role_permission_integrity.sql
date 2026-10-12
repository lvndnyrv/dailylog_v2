-- Role permissions must form usable workflows: edit/approve always imply view.
-- Role-library changes are security changes and belong in the audit trail.

create or replace function public.normalize_center_role_permissions(p_permissions jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  with areas(area) as (
    select unnest(array[
      'daily_logs', 'attendance', 'medications', 'incidents', 'children',
      'enrollment', 'broadcasts', 'billing', 'reports', 'staff'
    ]::text[])
  ), normalized as (
    select area,
           coalesce(p_permissions->area->>'edit', 'false') = 'true' as can_edit,
           coalesce(p_permissions->area->>'approve', 'false') = 'true' as can_approve,
           coalesce(p_permissions->area->>'view', 'false') = 'true' as can_view
      from areas
  )
  select coalesce(
    jsonb_object_agg(
      area,
      jsonb_build_object(
        'view', can_view or can_edit or can_approve,
        'edit', can_edit,
        'approve', can_approve
      )
      order by area
    ),
    '{}'::jsonb
  )
  from normalized
$$;

create or replace function public.validate_center_role_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(coalesce(new.name, ''));
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  if char_length(new.name) not between 1 and 80 then
    raise exception 'Role name must be between 1 and 80 characters.';
  end if;
  if char_length(coalesce(new.description, '')) > 300 then
    raise exception 'Role description cannot exceed 300 characters.';
  end if;
  if new.permissions is null or jsonb_typeof(new.permissions) <> 'object' then
    raise exception 'Role permissions must be an object.';
  end if;
  new.permissions := public.normalize_center_role_permissions(new.permissions);
  return new;
end
$$;

update public.center_roles
   set permissions = public.normalize_center_role_permissions(permissions)
 where permissions is distinct from public.normalize_center_role_permissions(permissions);

drop trigger if exists validate_center_role_integrity on public.center_roles;
create trigger validate_center_role_integrity
before insert or update of name, description, permissions on public.center_roles
for each row execute function public.validate_center_role_integrity();

drop trigger if exists audit_center_roles on public.center_roles;
create trigger audit_center_roles
after insert or update or delete on public.center_roles
for each row execute function public.audit_write();
