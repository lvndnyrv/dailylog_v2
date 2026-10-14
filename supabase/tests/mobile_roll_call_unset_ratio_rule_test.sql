-- Rollback-only verification: a conservative 1:1 snapshot is not a rule.
begin;
create or replace function pg_temp.impersonate(p_role text, p_id uuid default null)
returns void language plpgsql as $$ begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', p_role)::text, true);
end; $$;
do $$
declare
  center_id uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  room_id uuid;
  result jsonb;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms(daycare_id, name, capacity, ratio_children_per_educator)
    values(center_id, 'Rollback unconfigured ratio', 12, null) returning id into room_id;
  perform pg_temp.impersonate('authenticated', owner_id);
  result := public.get_mobile_roll_call(room_id);
  if result->'ratio'->>'configured' <> 'false'
     or result->'ratio'->>'configured_limit' is not null
     or (result->'ratio'->>'max_children_per_staff')::integer <> 1 then
    raise exception 'FAIL: unset rule was not distinguished from 1:1 safety fallback: %', result->'ratio';
  end if;
  perform pg_temp.impersonate('postgres', owner_id);
  update public.classrooms set ratio_children_per_educator = 4 where id = room_id;
  perform pg_temp.impersonate('authenticated', owner_id);
  result := public.get_mobile_roll_call(room_id);
  if result->'ratio'->>'configured' <> 'true'
     or (result->'ratio'->>'configured_limit')::integer <> 4 then
    raise exception 'FAIL: configured rule did not reach roll call: %', result->'ratio';
  end if;
  raise notice 'PASS: roll call reports configured and unconfigured ratio rules accurately';
end $$;
select 'PASS: roll-call ratio rule state distinguishes configured rules from the 1:1 safety fallback; rolled back' as result;
rollback;
