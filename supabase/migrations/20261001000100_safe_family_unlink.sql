-- Keep child-level family access valid when an administrator unlinks a
-- guardian. The delete and primary-contact handoff must be one transaction.

create or replace function public.admin_unlink_parent_child(
  p_child_id uuid,
  p_parent_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed public.parent_children%rowtype;
  v_next_primary uuid;
begin
  if auth.uid() is null or not public.can_write_child(p_child_id) then
    raise exception 'No access to manage this child';
  end if;

  select * into v_removed
    from public.parent_children
   where child_id = p_child_id
     and parent_id = p_parent_id
   for update;

  if v_removed.parent_id is null then
    raise exception 'This family member is no longer linked to the child';
  end if;

  -- Serialize all links for the child so two concurrent removals cannot both
  -- choose an invalid successor.
  perform 1
    from public.parent_children
   where child_id = p_child_id
   order by created_at, parent_id
   for update;

  delete from public.parent_children
   where child_id = p_child_id
     and parent_id = p_parent_id;

  if v_removed.is_primary then
    select parent_id into v_next_primary
      from public.parent_children
     where child_id = p_child_id
     order by created_at, parent_id
     limit 1;

    if v_next_primary is not null then
      update public.parent_children
         set is_primary = (parent_id = v_next_primary)
       where child_id = p_child_id;
    end if;
  end if;

  return jsonb_build_object(
    'removed_parent_id', p_parent_id,
    'removed_primary', v_removed.is_primary,
    'next_primary_id', v_next_primary,
    'remaining_guardians', (
      select count(*) from public.parent_children where child_id = p_child_id
    )
  );
end;
$$;

revoke all on function public.admin_unlink_parent_child(uuid, uuid) from public, anon;
grant execute on function public.admin_unlink_parent_child(uuid, uuid) to authenticated;

comment on function public.admin_unlink_parent_child(uuid, uuid) is
  'Atomically unlinks a guardian and promotes the oldest remaining guardian when the removed link was primary.';
