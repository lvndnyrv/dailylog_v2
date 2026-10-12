-- Cross-app invariant: a roster child created by staff must immediately have
-- the household identity required by billing, messaging and parent linking.

begin;

do $$
declare
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_room uuid := '20000000-0000-4000-a000-000000000001';
  v_child uuid;
  v_family uuid;
  v_count integer;
begin
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth
  ) values (
    v_daycare, v_room, 'Integration', 'Household', current_date - interval '3 years'
  ) returning id into v_child;

  select family_child.family_id
    into v_family
    from public.family_children family_child
   where family_child.child_id = v_child
     and family_child.is_primary;

  if v_family is null then
    raise exception 'FAIL: direct staff child creation did not create a household';
  end if;

  select count(*)
    into v_count
    from public.families family
   where family.id = v_family
     and family.daycare_id = v_daycare
     and family.display_name = 'Household family';

  if v_count <> 1 then
    raise exception 'FAIL: child household has the wrong center or display name';
  end if;

  raise notice 'PASS: staff child creation creates one center-scoped household';
end;
$$;

rollback;
