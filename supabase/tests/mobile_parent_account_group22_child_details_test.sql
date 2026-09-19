-- Parent Mobile Group 22 child-detail tests. No persistent mutations.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_unlinked_child constant uuid := '30000000-0000-4000-a000-000000000002';
  v_details jsonb;
  v_failed boolean := false;
begin
  perform pg_temp.impersonate('postgres');
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, current_date), current_date)
   where id = v_child;
  perform pg_temp.impersonate('authenticated', v_parent);

  v_details := public.get_parent_child_details(v_child);
  if v_details->>'id' <> v_child::text
     or not (v_details ? 'guardians')
     or not (v_details ? 'emergency_contacts')
     or not (v_details ? 'allergies') then
    raise exception 'FAIL: linked child details are incomplete: %', v_details;
  end if;
  raise notice 'PASS: linked parent can read complete child details';

  begin
    perform public.get_parent_child_details(v_unlinked_child);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: parent could read an unlinked child';
  end if;
  raise notice 'PASS: unlinked child details are denied';

  perform pg_temp.impersonate('anon');
  v_failed := false;
  begin
    perform public.get_parent_child_details(v_child);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: anonymous caller could read child details';
  end if;
  raise notice 'PASS: anonymous child detail access is denied';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 22 CHILD DETAILS TESTS: ALL PASSED' as result;
