-- Rollback-only check: shared care must not become permanent child or family authority.
begin;
create or replace function pg_temp.impersonate(p_role text, p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', p_role)::text, true);
end;
$$;

do $$
declare
  center_id uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  educator_id uuid := gen_random_uuid();
  parent_id uuid := gen_random_uuid();
  source_id uuid;
  host_id uuid;
  source_child uuid;
  host_child uuid;
  test_zone text;
  changed integer;
begin
  select zone into test_zone
    from unnest(array['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) zone
   where extract(isodow from now() at time zone zone) between 1 and 5
   limit 1;
  if test_zone is null then
    raise notice 'SKIP: live room-combination window is closed in every boundary test zone';
    return;
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  update public.daycares set timezone = test_zone where id = center_id;
  delete from public.center_closures where daycare_id = center_id;
  insert into public.classrooms(daycare_id, name, capacity, ratio_children_per_educator)
    values(center_id, 'Rollback permanent source', 12, 3) returning id into source_id;
  insert into public.classrooms(daycare_id, name, capacity, ratio_children_per_educator)
    values(center_id, 'Rollback temporary host', 12, 3) returning id into host_id;
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values(educator_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'permanent-boundary-' || educator_id || '@dailylog.invalid', '', now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Rollback permanent-room educator"}', now(), now());
  update public.profiles set role = 'educator', daycare_id = center_id, classroom_id = source_id
    where id = educator_id;
  insert into public.staff_members(daycare_id, profile_id, status)
    values(center_id, educator_id, 'active');
  -- The standard educator role cannot edit child records; explicitly grant it
  -- so this test exercises the temporary-room boundary, not the role default.
  insert into public.staff_permission_overrides(daycare_id, profile_id, permissions)
    values(center_id, educator_id, '{"children":{"edit":true}}'::jsonb);
  insert into public.children(daycare_id, classroom_id, first_name, last_name, date_of_birth)
    values(center_id, source_id, 'Rollback source', 'Child', '2024-01-01')
    returning id into source_child;
  insert into public.children(daycare_id, classroom_id, first_name, last_name, date_of_birth)
    values(center_id, host_id, 'Rollback host', 'Child', '2024-01-01')
    returning id into host_child;

  perform pg_temp.impersonate('authenticated', owner_id);
  perform public.save_room_combinations(jsonb_build_array(
    jsonb_build_object('period', 'morning', 'source_classroom_id', source_id,
      'host_classroom_id', host_id, 'starts_at', '00:00', 'ends_at', '23:59:59',
      'enabled', true),
    jsonb_build_object('period', 'evening', 'starts_at', '17:00', 'ends_at', '18:00',
      'enabled', false)
  ));
  perform pg_temp.impersonate('authenticated', educator_id);
  if host_id not in (select public.my_classroom_ids())
     or not public.can_write_child(host_child)
     or public.has_permanent_educator_room(host_id)
     or not public.has_permanent_educator_room(source_id) then
    raise exception 'FAIL: fixture did not separate temporary and permanent room access';
  end if;

  insert into public.children(daycare_id, classroom_id, first_name, last_name, date_of_birth)
    values(center_id, source_id, 'Allowed source', 'Child', '2024-01-01');
  update public.children set first_name = 'Allowed source edit' where id = source_child;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: permanent-room educator edit was denied'; end if;

  begin
    insert into public.children(daycare_id, classroom_id, first_name, last_name, date_of_birth)
      values(center_id, host_id, 'Denied temporary', 'Child', '2024-01-01');
    raise exception 'FAIL: temporary educator enrolled a partner-room child';
  exception when sqlstate '42501' then null;
  end;
  begin
    update public.children set first_name = 'Denied host edit' where id = host_child;
    get diagnostics changed = row_count;
    if changed <> 0 then raise exception 'FAIL: temporary educator changed partner child'; end if;
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.save_child_care_profile(host_child, '{}'::text[], 'Denied temporary edit',
      '[]'::jsonb, false);
    raise exception 'FAIL: temporary educator changed partner care profile through RPC';
  exception when sqlstate '42501' then null;
  end;
  perform public.create_parent_invite(source_child,
    'source-guardian-' || educator_id || '@dailylog.invalid', 'Parent');
  begin
    perform public.create_parent_invite(host_child,
      'host-guardian-' || educator_id || '@dailylog.invalid', 'Parent');
    raise exception 'FAIL: temporary educator invited a partner-room family member';
  exception when sqlstate '42501' then null;
  end;
  perform pg_temp.impersonate('postgres', owner_id);
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values(parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'boundary-parent-' || parent_id || '@dailylog.invalid', '', now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Rollback guardian"}', now(), now());
  update public.profiles set role = 'parent', daycare_id = center_id where id = parent_id;
  perform pg_temp.impersonate('authenticated', educator_id);
  insert into public.parent_children(parent_id, child_id, relationship)
    values(parent_id, source_child, 'Parent');
  begin
    insert into public.parent_children(parent_id, child_id, relationship)
      values(parent_id, host_child, 'Parent');
    raise exception 'FAIL: temporary educator linked a partner-room guardian';
  exception when sqlstate '42501' then null;
  end;
  begin
    update public.children set classroom_id = host_id where id = source_child;
    get diagnostics changed = row_count;
    if changed <> 0 then raise exception 'FAIL: educator moved a child into a temporary room'; end if;
  exception when sqlstate '42501' then null;
  end;

  perform pg_temp.impersonate('authenticated', owner_id);
  update public.children set first_name = 'Allowed admin edit' where id = host_child;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: administrator host-room edit was denied'; end if;
end;
$$;
rollback;
select 'PASS: permanent educator and admin child edits allowed; temporary coverage cannot enroll, edit, move, invite or link family; rolled back' as result;
