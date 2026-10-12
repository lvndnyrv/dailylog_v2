-- Allow authorized staff to correct a guardian relationship label without
-- bypassing household synchronization or the family audit trail.

create or replace function public.admin_update_guardian_relationship(
  p_child_id uuid,
  p_parent_id uuid,
  p_relationship text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.parent_children%rowtype;
  v_daycare_id uuid;
  v_child_name text;
  v_relationship text := nullif(btrim(coalesce(p_relationship, '')), '');
begin
  if auth.uid() is null
     or not public.has_permission('children', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'Child edit permission is required';
  end if;
  if v_relationship is null then
    raise exception 'Relationship is required';
  end if;
  if length(v_relationship) > 80 or v_relationship ~ '[[:cntrl:]]' then
    raise exception 'Relationship must be 80 characters or fewer';
  end if;

  select link.* into v_link
    from public.parent_children link
   where link.child_id = p_child_id
     and link.parent_id = p_parent_id
   for update;

  if v_link.parent_id is null then
    raise exception 'This family member is no longer linked to the child';
  end if;

  select child.daycare_id,
         btrim(child.first_name || ' ' || child.last_name)
    into v_daycare_id, v_child_name
    from public.children child
   where child.id = p_child_id;

  if v_link.relationship is not distinct from v_relationship then
    return jsonb_build_object(
      'child_id', p_child_id,
      'parent_id', p_parent_id,
      'relationship', v_relationship,
      'changed', false
    );
  end if;

  update public.parent_children
     set relationship = v_relationship
   where child_id = p_child_id
     and parent_id = p_parent_id;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_daycare_id,
    auth.uid(),
    'family_relationship_changed',
    'parent_child_access',
    p_child_id,
    jsonb_build_object(
      'parentId', p_parent_id,
      'relationship', v_link.relationship
    ),
    jsonb_build_object(
      'parentId', p_parent_id,
      'relationship', v_relationship
    )
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    v_daycare_id,
    p_parent_id,
    'family_relationship_changed',
    'Family relationship updated',
    'The center updated your relationship to ' || coalesce(v_child_name, 'this child') || ' to “' || v_relationship || '”.',
    jsonb_build_object(
      'type', 'family_relationship_changed',
      'childId', p_child_id,
      'relationship', v_relationship
    )
  );

  return jsonb_build_object(
    'child_id', p_child_id,
    'parent_id', p_parent_id,
    'relationship', v_relationship,
    'changed', true
  );
end;
$$;

revoke all on function public.admin_update_guardian_relationship(uuid, uuid, text) from public, anon;
grant execute on function public.admin_update_guardian_relationship(uuid, uuid, text) to authenticated;

comment on function public.admin_update_guardian_relationship(uuid, uuid, text) is
  'Updates a linked guardian relationship label, synchronizes the household, audits the change and notifies the guardian.';
