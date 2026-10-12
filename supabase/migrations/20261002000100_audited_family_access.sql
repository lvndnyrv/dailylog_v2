-- Keep every administrator family-access change permission-bound, atomic and
-- visible in the center audit trail.

create or replace function public.admin_set_pickup_authorization(
  p_child_id uuid,
  p_parent_id uuid,
  p_authorized boolean
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
begin
  if auth.uid() is null
     or not public.has_permission('children', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'Child edit permission is required';
  end if;
  if p_authorized is null then
    raise exception 'Choose whether pickup is authorized';
  end if;

  select link.*
    into v_link
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

  if v_link.pickup_authorized = p_authorized then
    return jsonb_build_object(
      'child_id', p_child_id,
      'parent_id', p_parent_id,
      'pickup_authorized', p_authorized,
      'changed', false
    );
  end if;

  update public.parent_children
     set pickup_authorized = p_authorized
   where child_id = p_child_id
     and parent_id = p_parent_id;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_daycare_id,
    auth.uid(),
    case when p_authorized then 'family_pickup_authorized'
         else 'family_pickup_revoked' end,
    'parent_child_access',
    p_child_id,
    jsonb_build_object(
      'parentId', p_parent_id,
      'pickupAuthorized', v_link.pickup_authorized
    ),
    jsonb_build_object(
      'parentId', p_parent_id,
      'pickupAuthorized', p_authorized
    )
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    v_daycare_id,
    p_parent_id,
    'pickup_access_changed',
    'Pickup access updated',
    case when p_authorized
      then 'You are now authorized to pick up ' || coalesce(v_child_name, 'this child') || '.'
      else 'Your pickup authorization for ' || coalesce(v_child_name, 'this child') || ' was removed. Contact the center with questions.'
    end,
    jsonb_build_object(
      'type', 'pickup_access_changed',
      'childId', p_child_id,
      'pickupAuthorized', p_authorized
    )
  );

  return jsonb_build_object(
    'child_id', p_child_id,
    'parent_id', p_parent_id,
    'pickup_authorized', p_authorized,
    'changed', true
  );
end;
$$;

revoke all on function public.admin_set_pickup_authorization(uuid, uuid, boolean) from public, anon;
grant execute on function public.admin_set_pickup_authorization(uuid, uuid, boolean) to authenticated;

comment on function public.admin_set_pickup_authorization(uuid, uuid, boolean) is
  'Atomically changes a linked guardian pickup permission, records an audit event and notifies the guardian.';

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
  v_previous_primary uuid;
  v_daycare_id uuid;
begin
  if auth.uid() is null
     or not public.has_permission('children', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'Child edit permission is required';
  end if;

  select child.daycare_id into v_daycare_id
    from public.children child
   where child.id = p_child_id;

  perform 1
    from public.parent_children
   where child_id = p_child_id
   order by created_at, parent_id
   for update;

  if not exists (
    select 1 from public.parent_children
     where child_id = p_child_id and parent_id = p_parent_id
  ) then
    raise exception 'This family member is no longer linked to the child';
  end if;

  select parent_id into v_previous_primary
    from public.parent_children
   where child_id = p_child_id and is_primary
   order by created_at, parent_id
   limit 1;

  if v_previous_primary is not distinct from p_parent_id then
    select count(*) into v_guardian_count
      from public.parent_children where child_id = p_child_id;
    return jsonb_build_object(
      'child_id', p_child_id,
      'primary_parent_id', p_parent_id,
      'guardian_count', v_guardian_count,
      'changed', false
    );
  end if;

  update public.parent_children
     set is_primary = (parent_id = p_parent_id)
   where child_id = p_child_id
     and is_primary is distinct from (parent_id = p_parent_id);

  select count(*) into v_guardian_count
    from public.parent_children where child_id = p_child_id;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_daycare_id,
    auth.uid(),
    'family_primary_guardian_changed',
    'parent_child_access',
    p_child_id,
    jsonb_build_object('primaryParentId', v_previous_primary),
    jsonb_build_object('primaryParentId', p_parent_id)
  );

  return jsonb_build_object(
    'child_id', p_child_id,
    'primary_parent_id', p_parent_id,
    'guardian_count', v_guardian_count,
    'changed', true
  );
end;
$$;

revoke all on function public.admin_set_primary_guardian(uuid, uuid) from public, anon;
grant execute on function public.admin_set_primary_guardian(uuid, uuid) to authenticated;

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
  v_daycare_id uuid;
  v_remaining integer;
begin
  if auth.uid() is null
     or not public.has_permission('children', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'Child edit permission is required';
  end if;

  select child.daycare_id into v_daycare_id
    from public.children child
   where child.id = p_child_id;

  perform 1
    from public.parent_children
   where child_id = p_child_id
   order by created_at, parent_id
   for update;

  select * into v_removed
    from public.parent_children
   where child_id = p_child_id
     and parent_id = p_parent_id;

  if v_removed.parent_id is null then
    raise exception 'This family member is no longer linked to the child';
  end if;

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

  select count(*) into v_remaining
    from public.parent_children where child_id = p_child_id;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_daycare_id,
    auth.uid(),
    'family_guardian_unlinked',
    'parent_child_access',
    p_child_id,
    jsonb_build_object(
      'parentId', p_parent_id,
      'relationship', v_removed.relationship,
      'pickupAuthorized', v_removed.pickup_authorized,
      'isPrimary', v_removed.is_primary
    ),
    jsonb_build_object(
      'nextPrimaryParentId', v_next_primary,
      'remainingGuardians', v_remaining
    )
  );

  return jsonb_build_object(
    'removed_parent_id', p_parent_id,
    'removed_primary', v_removed.is_primary,
    'next_primary_id', v_next_primary,
    'remaining_guardians', v_remaining
  );
end;
$$;

revoke all on function public.admin_unlink_parent_child(uuid, uuid) from public, anon;
grant execute on function public.admin_unlink_parent_child(uuid, uuid) to authenticated;

comment on function public.admin_unlink_parent_child(uuid, uuid) is
  'Atomically unlinks a guardian, promotes a successor when needed and records the change in the center audit trail.';
