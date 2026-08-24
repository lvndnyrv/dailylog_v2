-- Allow the vetted Group 22 co-guardian workflow through the shared mutation
-- trigger. RLS still blocks direct parent writes to child_invite_codes; these
-- branches only allow the SECURITY DEFINER RPC to write a row owned by the
-- current parent for a child already linked to that parent.

create or replace function public.enforce_child_admin_mutation()
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

    if public.get_my_role() = 'parent' then
      if tg_op = 'INSERT'
         and new.created_by = auth.uid()
         and exists (
           select 1 from public.parent_children mine
           where mine.parent_id = auth.uid() and mine.child_id = new.child_id
         ) then
        return new;
      end if;

      if tg_op = 'DELETE'
         and old.created_by = auth.uid()
         and old.used_at is null
         and exists (
           select 1 from public.parent_children mine
           where mine.parent_id = auth.uid() and mine.child_id = old.child_id
         ) then
        return old;
      end if;
    end if;
  end if;

  if tg_table_name = 'child_pickups'
     and public.get_my_role() = 'parent'
     and current_setting('dailylog.parent_pickup_rpc', true) = 'allowed' then
    return coalesce(new, old);
  end if;

  if not public.has_permission('children', 'edit') then
    raise exception 'Children edit permission required';
  end if;
  return coalesce(new, old);
end;
$$;
