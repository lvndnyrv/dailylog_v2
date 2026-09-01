-- Rollback-safe checks for immutable, tenant-scoped ratio intervals and packs.
begin;
create or replace function pg_temp.impersonate(p_role text,p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_user,'role',case when p_role='postgres' then 'service_role' else p_role end)::text,true);
  perform set_config('role',p_role,true);
end $$;
create function pg_temp.expect_denied(p_sql text)
returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FAIL: operation unexpectedly allowed: %',p_sql;
end $$;
do $$
declare
  v_owner uuid:='00000000-0000-4000-a000-000000000001';
  v_daycare uuid;v_other uuid;v_room uuid;v_other_room uuid;v_share jsonb;v_pack jsonb;
begin
  select daycare_id into v_daycare from public.profiles where id=v_owner;
  if v_daycare is null then raise exception 'Missing dev owner fixture'; end if;
  perform pg_temp.impersonate('postgres');
  update public.daycares set opens_at='00:00',closes_at='23:59' where id=v_daycare;
  insert into public.classrooms(daycare_id,name,ratio_children_per_educator,capacity)
    values(v_daycare,'Rollback-only ratio ledger room',4,12) returning id into v_room;
  perform public._record_room_ratio_history(v_room,clock_timestamp(),'scheduled_sweep');
  update public.classrooms set ratio_children_per_educator=5 where id=v_room;
  if (select count(*) from public.room_ratio_history where classroom_id=v_room)<>2 then
    raise exception 'FAIL: room-rule change did not create a second interval';
  end if;
  if (select count(*) from public.room_ratio_history where classroom_id=v_room and ends_at is null)<>1 then
    raise exception 'FAIL: room does not have exactly one current interval';
  end if;
  if exists(select 1 from public.room_ratio_history where classroom_id=v_room and ends_at<=starts_at) then
    raise exception 'FAIL: invalid ratio interval duration';
  end if;
  insert into public.daycares(name) values('Rollback-only other ratio center') returning id into v_other;
  insert into public.classrooms(daycare_id,name,ratio_children_per_educator,capacity)
    values(v_other,'Private other-center ratio room',3,6) returning id into v_other_room;
  perform public._record_room_ratio_history(v_other_room,clock_timestamp(),'scheduled_sweep');

  perform pg_temp.impersonate('authenticated',v_owner);
  if exists(select 1 from public.room_ratio_history where daycare_id=v_other) then
    raise exception 'FAIL: cross-center ratio history visible';
  end if;
  perform pg_temp.expect_denied(format(
    'insert into public.room_ratio_history(daycare_id,classroom_id,starts_at,present_count,staff_count,required_staff,max_children_per_staff,source) values(%L,%L,now(),0,0,0,4,''attendance'')',
    v_daycare,v_room));
  perform pg_temp.expect_denied(format(
    'select public._record_room_ratio_history(%L,now(),''attendance'')',v_room));
  v_pack:=public.get_compliance_inspection_pack();
  if v_pack->'ratio_ledger' is null or v_pack#>'{ratio_ledger,intervals}' is null then
    raise exception 'FAIL: authenticated inspection pack omitted ratio ledger';
  end if;
  v_share:=public.create_compliance_inspection_share('Rollback-only ratio ledger share');
  perform pg_temp.impersonate('anon');
  v_pack:=public.read_compliance_inspection_share(v_share->>'token');
  if v_pack->'ratio_ledger' is null then
    raise exception 'FAIL: authorized inspector share omitted ratio ledger';
  end if;
end $$;
rollback;
select 'PASS: ratio intervals are sequential, immutable, tenant-scoped and included in authenticated/shared inspection packs' as result;
