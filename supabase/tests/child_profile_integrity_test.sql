-- Group 13 roster/profile integrity. All fixtures and mutations roll back.
begin;
set local statement_timeout = '30s';

create function pg_temp.impersonate(p_role text, p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', p_role)::text, true);
end;
$$;

do $$
declare
  v_center constant uuid := '10000000-0000-4000-a000-000000000001';
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_room uuid;
  v_other_room uuid;
  v_child uuid;
  v_result jsonb;
  v_failed boolean;
  v_count integer;
begin
  perform pg_temp.impersonate('postgres', v_owner);
  select classroom_id into v_room from public.profiles where id = v_educator;
  if v_room is null then raise exception 'FAIL: educator room fixture missing'; end if;
  insert into public.classrooms (daycare_id, name, age_group)
  values (v_center, 'Rollback child-profile room', 'Test') returning id into v_other_room;

  v_failed := false;
  begin
    insert into public.children (
      daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
    ) values (
      v_center, v_room, 'Future', 'Child', public.center_today() + 1, public.center_today()
    );
  exception when others then v_failed := position('future' in lower(sqlerrm)) > 0;
  end;
  if not v_failed then raise exception 'FAIL: future birth date was accepted'; end if;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    v_center, v_room, 'Profile', 'Integrity', public.center_today() - 1200, public.center_today()
  ) returning id into v_child;
  raise notice 'PASS: invalid child details are rejected before storage';

  perform pg_temp.impersonate('authenticated', v_educator);
  v_failed := false;
  begin
    update public.children set classroom_id = v_other_room where id = v_child;
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed or not exists (
    select 1 from public.children where id = v_child and classroom_id = v_room
  ) then raise exception 'FAIL: educator moved a child into an unassigned classroom'; end if;

  v_result := public.save_child_care_profile(
    v_child,
    array[' Peanuts ', 'peanuts', 'Dairy'],
    'Carries an EpiPen',
    '[{"name":"Grandma Kim","relation":"Grandmother","phone":"416-555-0101"}]'::jsonb,
    false
  );
  if jsonb_array_length(v_result->'allergies') <> 2
     or v_result->'setup_state'->>'medical_reviewed' <> 'true'
     or not exists (
       select 1 from public.children
        where id = v_child
          and emergency_contacts->0->>'name' = 'Grandma Kim'
     ) then
    raise exception 'FAIL: atomic care profile did not normalize and save its record';
  end if;

  v_failed := false;
  begin
    perform public.save_child_care_profile(
      v_child, array['Peanuts'], null, '[]'::jsonb, true
    );
  exception when others then v_failed := position('clear allergies' in lower(sqlerrm)) > 0;
  end;
  if not v_failed then raise exception 'FAIL: contradictory no-known-medical state was accepted'; end if;
  raise notice 'PASS: educator care edits are atomic and internally consistent';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.save_child_care_profile(v_child, '{}', null, '[]'::jsonb, true);
  exception when others then v_failed := position('do not have access' in lower(sqlerrm)) > 0;
  end;
  if not v_failed then raise exception 'FAIL: parent changed the staff-managed care profile'; end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  update public.children set classroom_id = v_other_room where id = v_child;
  if not exists (select 1 from public.children where id = v_child and classroom_id = v_other_room) then
    raise exception 'FAIL: center admin could not move a child within the center';
  end if;
  raise notice 'PASS: classroom moves respect educator assignment and administrator authority';
end;
$$;

rollback;
select 'CHILD PROFILE INTEGRITY TESTS: ALL PASSED' as result;
