-- Group 24 trusted transition bridge.
-- Existing enrollment mutation guards remain strict for direct API writes.
-- Validated SECURITY DEFINER functions execute the table statement as their
-- postgres owner. Direct PostgREST writes execute as anon/authenticated and
-- still have to pass the existing permission checks.

create or replace function public.enforce_enrollment_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user = 'postgres'
     or auth.role() = 'service_role'
     or (auth.uid() is null and auth.role() is null)
  then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.source = 'website' and new.stage = 'inquiry'
     and new.child_id is null then return new; end if;
  if not has_permission('enrollment', 'edit') then
    raise exception 'Enrollment edit permission required';
  end if;
  return coalesce(new, old);
end;
$$;
