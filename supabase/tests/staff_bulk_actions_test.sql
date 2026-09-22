-- Rollback-safe Group 4n roster bulk-action checks.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', case when p_role = 'postgres' then 'service_role' else p_role end)::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_daycare uuid;
  v_room uuid;
  v_staff_ids uuid[];
  v_profile_ids uuid[];
  v_result jsonb;
  v_body text := 'Codex rollback-safe bulk staff message';
begin
  select profile.daycare_id into v_daycare from public.profiles profile where profile.id = v_owner;
  select classroom.id into v_room from public.classrooms classroom
   where classroom.daycare_id = v_daycare and classroom.archived_at is null
   order by classroom.created_at limit 1;
  select array_agg(member.id order by member.id), array_agg(member.profile_id order by member.id)
    into v_staff_ids, v_profile_ids
    from (
      select staff.id, staff.profile_id
        from public.staff_members staff
        join public.profiles profile on profile.id = staff.profile_id
       where staff.daycare_id = v_daycare
         and staff.status = 'active'
         and staff.archived_at is null
         and profile.role = 'educator'
         and profile.id <> v_owner
       order by staff.created_at
       limit 2
    ) member;
  if v_room is null or cardinality(v_staff_ids) <> 2 then
    raise exception 'Missing Group 4n fixtures';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  v_result := public.bulk_assign_staff_room(v_staff_ids, v_room);
  if coalesce((v_result ->> 'updated')::integer, 0) <> 2 then
    raise exception 'FAIL: two educators were not assigned';
  end if;
  if (select count(*) from public.profiles profile where profile.id = any(v_profile_ids) and profile.classroom_id = v_room) <> 2 then
    raise exception 'FAIL: primary room assignments were not updated';
  end if;
  if (select count(*) from public.educator_classrooms assignment where assignment.educator_id = any(v_profile_ids) and assignment.classroom_id = v_room) <> 2 then
    raise exception 'FAIL: educator room access was not synchronized';
  end if;

  v_result := public.send_bulk_staff_message(v_profile_ids, v_body);
  if coalesce((v_result ->> 'sent')::integer, 0) <> 2 then
    raise exception 'FAIL: two private staff messages were not sent';
  end if;
  if (select count(*) from public.messages message where message.sender_id = v_owner and message.body = v_body) <> 2 then
    raise exception 'FAIL: bulk messages were not persisted independently';
  end if;
  if (select count(*) from public.notifications notification where notification.kind = 'staff_message' and notification.body = v_body) <> 2 then
    raise exception 'FAIL: bulk message notifications were not created';
  end if;
  if (select count(*) from public.notification_outbox delivery where delivery.kind = 'staff_message' and delivery.body = v_body) <> 2 then
    raise exception 'FAIL: recipient push deliveries were not queued';
  end if;
  if not exists (select 1 from public.audit_log audit where audit.action = 'bulk_room_assignment' and audit.actor_id = v_owner)
     or not exists (select 1 from public.audit_log audit where audit.action = 'bulk_staff_message' and audit.actor_id = v_owner) then
    raise exception 'FAIL: bulk actions were not audited';
  end if;

  begin
    perform public.send_bulk_staff_message(array[v_owner], 'Invalid self message');
    raise exception 'FAIL: owner sent a bulk message to their own account';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('authenticated', v_educator);
  begin
    perform public.bulk_assign_staff_room(v_staff_ids, v_room);
    raise exception 'FAIL: educator used admin bulk room assignment';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

rollback;
select 'PASS: roster bulk messaging, room assignment, audit and role boundaries are enforced' as result;
