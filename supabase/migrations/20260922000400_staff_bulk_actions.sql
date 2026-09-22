-- Group 4n: atomic roster bulk actions with center and permission boundaries.

create or replace function public.bulk_assign_staff_room(
  p_staff_member_ids uuid[],
  p_classroom_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_profile_ids uuid[];
  v_updated integer;
begin
  if v_daycare is null or not public.has_permission('staff', 'edit') then
    raise exception 'Staff edit permission required';
  end if;
  if p_staff_member_ids is null or cardinality(p_staff_member_ids) not between 1 and 100 then
    raise exception 'Choose between 1 and 100 staff members';
  end if;
  if cardinality(p_staff_member_ids) <> cardinality(array(select distinct unnest(p_staff_member_ids))) then
    raise exception 'Duplicate staff selections are not allowed';
  end if;
  if p_classroom_id is not null and not exists (
    select 1 from public.classrooms classroom
     where classroom.id = p_classroom_id
       and classroom.daycare_id = v_daycare
       and classroom.archived_at is null
  ) then
    raise exception 'The selected room is not available';
  end if;

  select array_agg(member.profile_id order by member.profile_id)
    into v_profile_ids
    from public.staff_members member
    join public.profiles profile on profile.id = member.profile_id
   where member.id = any(p_staff_member_ids)
     and member.daycare_id = v_daycare
     and member.status = 'active'
     and member.archived_at is null
     and profile.daycare_id = v_daycare
     and profile.role = 'educator'
     and profile.archived_at is null;

  if coalesce(cardinality(v_profile_ids), 0) <> cardinality(p_staff_member_ids) then
    raise exception 'Only active educators from this center can be assigned to a room';
  end if;

  update public.profiles profile
     set classroom_id = p_classroom_id
   where profile.id = any(v_profile_ids);
  get diagnostics v_updated = row_count;

  delete from public.educator_classrooms assignment
   where assignment.educator_id = any(v_profile_ids);
  if p_classroom_id is not null then
    insert into public.educator_classrooms (educator_id, classroom_id)
    select profile_id, p_classroom_id from unnest(v_profile_ids) profile_id
    on conflict do nothing;
  end if;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, after
  ) values (
    v_daycare,
    auth.uid(),
    'bulk_room_assignment',
    'staff_members',
    jsonb_build_object(
      'staffMemberIds', to_jsonb(p_staff_member_ids),
      'classroomId', p_classroom_id,
      'updated', v_updated
    )
  );
  return jsonb_build_object('updated', v_updated);
end;
$$;

create or replace function public.send_bulk_staff_message(
  p_profile_ids uuid[],
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_profile_id uuid;
  v_conversation_id uuid;
  v_sent integer := 0;
begin
  if v_daycare is null or not public.has_permission('staff', 'edit') then
    raise exception 'Staff edit permission required';
  end if;
  if p_profile_ids is null or cardinality(p_profile_ids) not between 1 and 50 then
    raise exception 'Choose between 1 and 50 staff members';
  end if;
  if cardinality(p_profile_ids) <> cardinality(array(select distinct unnest(p_profile_ids))) then
    raise exception 'Duplicate staff selections are not allowed';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'Write a message first';
  end if;
  if length(btrim(p_body)) > 4000 then
    raise exception 'Message is too long';
  end if;
  if auth.uid() = any(p_profile_ids) then
    raise exception 'Remove your own account from the selection';
  end if;
  if (
    select count(*)
      from public.profiles profile
     where profile.id = any(p_profile_ids)
       and profile.daycare_id = v_daycare
       and profile.role in ('owner_admin', 'admin', 'educator')
       and profile.archived_at is null
  ) <> cardinality(p_profile_ids) then
    raise exception 'Every recipient must be active staff in this center';
  end if;

  foreach v_profile_id in array p_profile_ids loop
    v_conversation_id := public.get_or_create_staff_conversation(v_profile_id);
    perform public.send_staff_message(v_conversation_id, btrim(p_body));
    v_sent := v_sent + 1;
  end loop;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, after
  ) values (
    v_daycare,
    auth.uid(),
    'bulk_staff_message',
    'messages',
    jsonb_build_object(
      'recipientIds', to_jsonb(p_profile_ids),
      'recipientCount', v_sent,
      'characterCount', length(btrim(p_body))
    )
  );
  return jsonb_build_object('sent', v_sent);
end;
$$;

revoke all on function public.bulk_assign_staff_room(uuid[], uuid) from public, anon;
revoke all on function public.send_bulk_staff_message(uuid[], text) from public, anon;
grant execute on function public.bulk_assign_staff_room(uuid[], uuid) to authenticated, service_role;
grant execute on function public.send_bulk_staff_message(uuid[], text) to authenticated, service_role;
