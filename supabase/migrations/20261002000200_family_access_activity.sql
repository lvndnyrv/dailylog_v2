-- Give authorized administrators a focused, read-only history for one family
-- account without exposing the center's full audit log to the mobile client.

create or replace function public.admin_list_family_access_activity(
  p_parent_id uuid,
  p_limit integer default 20
)
returns table (
  event_id uuid,
  action text,
  child_id uuid,
  child_name text,
  actor_name text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if auth.uid() is null
     or v_daycare_id is null
     or not public.has_permission('reports', 'view') then
    raise exception 'Report viewing permission is required';
  end if;

  if not exists (
    select 1 from public.profiles family
     where family.id = p_parent_id
       and family.daycare_id = v_daycare_id
       and family.role = 'parent'
  ) then
    raise exception 'Family account not found';
  end if;

  return query
  select audit.id,
         audit.action,
         audit.entity_id,
         coalesce(
           nullif(btrim(child.first_name || ' ' || child.last_name), ''),
           'Child record'
         ),
         coalesce(nullif(btrim(actor.full_name), ''), actor.email, 'DailyLog'),
         audit.before,
         audit.after,
         audit.created_at
    from public.audit_log audit
    left join public.children child on child.id = audit.entity_id
    left join public.profiles actor on actor.id = audit.actor_id
   where audit.daycare_id = v_daycare_id
     and audit.entity_type = 'parent_child_access'
     and (
       audit.before ->> 'parentId' = p_parent_id::text
       or audit.after ->> 'parentId' = p_parent_id::text
       or audit.before ->> 'primaryParentId' = p_parent_id::text
       or audit.after ->> 'primaryParentId' = p_parent_id::text
     )
   order by audit.created_at desc
   limit v_limit;
end;
$$;

revoke all on function public.admin_list_family_access_activity(uuid, integer) from public, anon;
grant execute on function public.admin_list_family_access_activity(uuid, integer) to authenticated;

comment on function public.admin_list_family_access_activity(uuid, integer) is
  'Returns recent audited family-access changes for one parent account to authorized report viewers.';
