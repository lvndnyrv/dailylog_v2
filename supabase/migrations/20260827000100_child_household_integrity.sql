-- Every child needs a durable household identity before a guardian is linked.
-- Admin web and educator mobile may both create roster records directly; the
-- parent_children trigger will add guardians to this placeholder household
-- later instead of creating a competing family.

create or replace function public.ensure_child_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  if exists (
    select 1
      from public.family_children family_child
     where family_child.child_id = new.id
  ) then
    return new;
  end if;

  insert into public.families (daycare_id, display_name)
  values (
    new.daycare_id,
    coalesce(nullif(trim(new.last_name), ''), 'Family') || ' family'
  )
  returning id into v_family_id;

  insert into public.family_children (family_id, child_id, is_primary)
  values (v_family_id, new.id, true)
  on conflict (family_id, child_id) do nothing;

  return new;
end;
$$;

revoke all on function public.ensure_child_household() from public;

drop trigger if exists children_ensure_household on public.children;
create trigger children_ensure_household
  after insert on public.children
  for each row execute function public.ensure_child_household();

-- Repair children created between the household migration and this invariant.
do $$
declare
  child_row record;
  v_family_id uuid;
begin
  for child_row in
    select child.id, child.daycare_id, child.last_name
      from public.children child
     where not exists (
       select 1
         from public.family_children family_child
        where family_child.child_id = child.id
     )
     order by child.created_at, child.id
  loop
    insert into public.families (daycare_id, display_name)
    values (
      child_row.daycare_id,
      coalesce(nullif(trim(child_row.last_name), ''), 'Family') || ' family'
    )
    returning id into v_family_id;

    insert into public.family_children (family_id, child_id, is_primary)
    values (v_family_id, child_row.id, true)
    on conflict (family_id, child_id) do nothing;
  end loop;
end;
$$;
