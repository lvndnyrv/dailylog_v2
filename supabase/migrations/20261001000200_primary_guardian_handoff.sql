-- Give administrators a single atomic operation for handing primary guardian
-- responsibility to another already-linked family member.

create or replace function public.admin_set_primary_guardian(
  p_child_id uuid,
  p_parent_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guardian_count integer;
begin
  if auth.uid() is null or not public.can_write_child(p_child_id) then
    raise exception 'No access to manage this child';
  end if;

  -- Lock the complete relationship set so concurrent handoffs cannot produce
  -- two primaries or overwrite each other.
  perform 1
    from public.parent_children
   where child_id = p_child_id
   order by created_at, parent_id
   for update;

  if not exists (
    select 1
      from public.parent_children
     where child_id = p_child_id
       and parent_id = p_parent_id
  ) then
    raise exception 'This family member is no longer linked to the child';
  end if;

  update public.parent_children
     set is_primary = (parent_id = p_parent_id)
   where child_id = p_child_id
     and is_primary is distinct from (parent_id = p_parent_id);

  select count(*) into v_guardian_count
    from public.parent_children
   where child_id = p_child_id;

  return jsonb_build_object(
    'child_id', p_child_id,
    'primary_parent_id', p_parent_id,
    'guardian_count', v_guardian_count
  );
end;
$$;

revoke all on function public.admin_set_primary_guardian(uuid, uuid) from public, anon;
grant execute on function public.admin_set_primary_guardian(uuid, uuid) to authenticated;

comment on function public.admin_set_primary_guardian(uuid, uuid) is
  'Atomically promotes one linked guardian and clears primary status from the other child links.';
