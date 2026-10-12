-- Link an existing parent account through one atomic, audited operation rather
-- than allowing the mobile client to write the relationship table directly.

create or replace function public.admin_link_existing_guardian(
  p_child_id uuid,
  p_parent_id uuid,
  p_relationship text,
  p_pickup_authorized boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_relationship text := nullif(btrim(coalesce(p_relationship, '')), '');
  v_parent_name text;
  v_child_name text;
  v_is_primary boolean;
begin
  if auth.uid() is null
     or v_daycare_id is null
     or not public.has_permission('children', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'Child edit permission is required';
  end if;
  if v_relationship is null then
    raise exception 'Relationship is required';
  end if;
  if length(v_relationship) > 80 then
    raise exception 'Relationship must be 80 characters or fewer';
  end if;
  if p_pickup_authorized is null then
    raise exception 'Choose whether pickup is authorized';
  end if;

  select btrim(child.first_name || ' ' || child.last_name)
    into v_child_name
    from public.children child
   where child.id = p_child_id
     and child.daycare_id = v_daycare_id
     and child.archived_at is null;

  if v_child_name is null then
    raise exception 'Active child not found';
  end if;

  select coalesce(nullif(btrim(parent.full_name), ''), parent.email)
    into v_parent_name
    from public.profiles parent
   where parent.id = p_parent_id
     and parent.daycare_id = v_daycare_id
     and parent.role = 'parent'
     and parent.archived_at is null;

  if v_parent_name is null then
    raise exception 'Active parent account not found in this center';
  end if;

  perform 1
    from public.parent_children link
   where link.child_id = p_child_id
   order by link.created_at, link.parent_id
   for update;

  if exists (
    select 1 from public.parent_children link
     where link.child_id = p_child_id
       and link.parent_id = p_parent_id
  ) then
    raise exception 'This family member is already linked to the child';
  end if;

  select not exists (
    select 1 from public.parent_children link
     where link.child_id = p_child_id
       and link.is_primary
  ) into v_is_primary;

  insert into public.parent_children (
    parent_id, child_id, relationship, pickup_authorized, is_primary
  ) values (
    p_parent_id, p_child_id, v_relationship, p_pickup_authorized, v_is_primary
  );

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, after
  ) values (
    v_daycare_id,
    auth.uid(),
    'family_guardian_linked',
    'parent_child_access',
    p_child_id,
    jsonb_build_object(
      'parentId', p_parent_id,
      'relationship', v_relationship,
      'pickupAuthorized', p_pickup_authorized,
      'isPrimary', v_is_primary
    )
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    v_daycare_id,
    p_parent_id,
    'family_access_linked',
    'Family access connected',
    'Your account is now connected to ' || v_child_name || '''s DailyLog.',
    jsonb_build_object(
      'type', 'family_access_linked',
      'childId', p_child_id,
      'relationship', v_relationship,
      'pickupAuthorized', p_pickup_authorized
    )
  );

  return jsonb_build_object(
    'child_id', p_child_id,
    'parent_id', p_parent_id,
    'relationship', v_relationship,
    'pickup_authorized', p_pickup_authorized,
    'is_primary', v_is_primary
  );
end;
$$;

revoke all on function public.admin_link_existing_guardian(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.admin_link_existing_guardian(uuid, uuid, text, boolean) to authenticated;

comment on function public.admin_link_existing_guardian(uuid, uuid, text, boolean) is
  'Links an existing center parent to a child, assigns a missing primary guardian, audits the change and notifies the parent.';
