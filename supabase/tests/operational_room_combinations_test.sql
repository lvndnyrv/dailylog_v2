-- Rollback-only operational 7f checks. No test data or notifications persist.
begin;
create or replace function pg_temp.impersonate(p_role text,p_id uuid default null)
returns void language plpgsql as $$ begin
  perform set_config('role','postgres',true); perform set_config('role',p_role,true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_id,'role',p_role)::text,true);
end; $$;
do $$
declare
  center_id uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  source_id uuid; host_id uuid; educator_id uuid := gen_random_uuid(); other_educator uuid := gen_random_uuid();
  member_id uuid; child_id uuid; host_child uuid; third_child uuid; fourth_child uuid;
  combination_id uuid; source_count integer; host_count integer; counted_staff integer;
  before_home uuid; test_zone text; monday date := '2026-09-14'; record_id uuid;
  initial_rules jsonb; current_day date; p uuid;
begin
  -- Choose a zone with a current weekday so public now()-based APIs are exercised.
  select zone into test_zone from unnest(array['UTC','Pacific/Kiritimati','Pacific/Pago_Pago']) zone
    where extract(isodow from now() at time zone zone) between 1 and 5 limit 1;
  if test_zone is null then
    raise notice 'SKIP: live room-combination window is closed in every boundary test zone';
    return;
  end if;
  perform pg_temp.impersonate('postgres',owner_id);
  update public.daycares set timezone = test_zone,time_tracking_enabled = false,ratio_block_checkins = false where id = center_id;
  current_day := (now() at time zone test_zone)::date;
  -- Exclude existing demo closures only inside this rolled-back transaction.
  delete from public.center_closures where daycare_id = center_id;
  insert into public.classrooms(daycare_id,name,capacity,ratio_children_per_educator)
    values(center_id,'Rollback combined source',6,2) returning id into source_id;
  insert into public.classrooms(daycare_id,name,capacity,ratio_children_per_educator)
    values(center_id,'Rollback combined host',3,5) returning id into host_id;
  foreach p in array array[educator_id,other_educator] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(p,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','combined-'||p||'@dailylog.invalid','',now(),
      '{"provider":"email","providers":["email"]}','{"full_name":"Rollback combined educator"}',now(),now());
    update public.profiles set role='educator',daycare_id=center_id,classroom_id=case when p=educator_id then source_id else host_id end where id=p;
    insert into public.staff_members(daycare_id,profile_id,status) values(center_id,p,'active');
  end loop;
  insert into public.children(daycare_id,classroom_id,first_name,last_name,date_of_birth)
    values(center_id,source_id,'Rollback source','Combination','2025-01-01') returning id into child_id;
  insert into public.children(daycare_id,classroom_id,first_name,last_name,date_of_birth)
    values(center_id,host_id,'Rollback host','Combination','2023-01-01') returning id into host_child;
  insert into public.children(daycare_id,classroom_id,first_name,last_name,date_of_birth)
    values(center_id,source_id,'Rollback third','Combination','2025-01-01') returning id into third_child;
  insert into public.children(daycare_id,classroom_id,first_name,last_name,date_of_birth)
    values(center_id,source_id,'Rollback fourth','Combination','2025-01-01') returning id into fourth_child;
  foreach p in array array[child_id,host_child,third_child] loop
    insert into public.attendance_records(daycare_id,child_id,date,checked_in_at,checked_in_by,method,status)
      values(center_id,p,current_day,now()-interval '5 minutes',owner_id,'educator','present');
  end loop;
  perform pg_temp.impersonate('authenticated',owner_id);
  initial_rules := jsonb_build_array(
    jsonb_build_object('period','morning','source_classroom_id',source_id,'host_classroom_id',host_id,'starts_at','00:00','ends_at','23:59:59','enabled',true),
    jsonb_build_object('period','evening','starts_at','17:00','ends_at','18:00','enabled',false));
  perform public.save_room_combinations(initial_rules);
  select id into combination_id from public.room_combinations where daycare_id=center_id and period='morning';
  begin update public.classrooms set ratio_children_per_educator=null where id=source_id;
    raise exception 'FAIL: active combination lost its licensed source ratio';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin update public.classrooms set capacity=null where id=host_id;
    raise exception 'FAIL: active combination lost its host capacity';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  select present_count,jsonb_array_length(educators) into host_count,counted_staff from public.get_rooms_live_status() where id=host_id;
  select present_count into source_count from public.get_rooms_live_status() where id=source_id;
  if host_count<>3 or counted_staff<>2 or source_count<>0 then raise exception 'FAIL: group was not aggregated exactly once (%/%/%)',host_count,counted_staff,source_count; end if;
  if not exists(select 1 from public.get_mobile_room_ratios() where id=host_id and present_count=3 and staff_count=2 and max_children_per_staff=2) then
    raise exception 'FAIL: mobile did not use the combined stricter ratio'; end if;
  if (select classroom_id from public.children where id=child_id)<>source_id then raise exception 'FAIL: home room changed'; end if;
  perform pg_temp.impersonate('authenticated',educator_id);
  if not exists(select 1 from public.notifications where profile_id=educator_id and kind='room_combination' and payload->>'screen'='RoomRatios') then
    raise exception 'FAIL: missing routed educator notification'; end if;
  if host_id not in(select public.my_classroom_ids()) or not public.can_write_child(host_child) then raise exception 'FAIL: temporary host access missing'; end if;
  if not exists(select 1 from public.get_my_operational_classrooms() where id=host_id and temporary and cardinality(member_room_ids)=2) then
    raise exception 'FAIL: room switcher does not mark temporary combined access'; end if;
  begin perform public.pause_room_combination_today(combination_id,true); raise exception 'FAIL: educator paused center schedule';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform pg_temp.impersonate('authenticated',owner_id);
  update public.daycares set ratio_block_checkins=true where id=center_id;
  begin
    insert into public.attendance_records(daycare_id,child_id,date,checked_in_at,checked_in_by,method,status)
      values(center_id,fourth_child,current_day,now(),owner_id,'kiosk','present');
    raise exception 'FAIL: host capacity did not block source-room check-in';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  update public.classrooms set capacity=6 where id=host_id;
  -- Remove one eligible teacher: 3 children now exceed the combined 1:2 ratio.
  perform pg_temp.impersonate('postgres',owner_id);
  update public.staff_members set background_check_required=true where profile_id=other_educator;
  perform pg_temp.impersonate('authenticated',owner_id);
  begin
    insert into public.attendance_records(daycare_id,child_id,date,checked_in_at,checked_in_by,method,status)
      values(center_id,fourth_child,current_day,now(),owner_id,'educator','present');
    raise exception 'FAIL: combined ratio did not block check-in';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform pg_temp.impersonate('postgres',owner_id);
  update public.staff_members set background_check_required=false where profile_id=other_educator;
  perform pg_temp.impersonate('authenticated',owner_id);
  insert into public.attendance_records(daycare_id,child_id,date,checked_in_at,checked_in_by,method,status)
    values(center_id,fourth_child,current_day,now(),owner_id,'parent','present') returning id into record_id;
  if not exists(select 1 from public.get_mobile_room_ratios() where id=host_id and present_count=4 and staff_count=2) then raise exception 'FAIL: safe check-in did not update host count'; end if;
  perform public.pause_room_combination_today(combination_id,true);
  if not exists(select 1 from public.get_mobile_room_ratios() where id=source_id and present_count=3 and staff_count=1) then raise exception 'FAIL: pause did not restore home counts'; end if;
  perform pg_temp.impersonate('authenticated',educator_id);
  if host_id in(select public.my_classroom_ids()) or public.can_write_child(host_child) then raise exception 'FAIL: temporary access survived pause'; end if;
  perform pg_temp.impersonate('authenticated',owner_id);
  perform public.pause_room_combination_today(combination_id,false);
  perform pg_temp.impersonate('postgres',owner_id);
  update public.room_combinations set starts_at='07:00',ends_at='08:00' where id=combination_id;
  if exists(select 1 from public._active_room_combination(source_id,(monday+time '06:59') at time zone test_zone))
    or not exists(select 1 from public._active_room_combination(source_id,(monday+time '07:00') at time zone test_zone))
    or exists(select 1 from public._active_room_combination(source_id,(monday+time '08:00') at time zone test_zone))
    or exists(select 1 from public._active_room_combination(source_id,((monday-1)+time '07:30') at time zone test_zone)) then
    raise exception 'FAIL: weekday/start/end boundary handling'; end if;
  update public.room_combinations set paused_on=monday where id=combination_id;
  if exists(select 1 from public._active_room_combination(source_id,(monday+time '07:30') at time zone test_zone))
    or not exists(select 1 from public._active_room_combination(source_id,((monday+1)+time '07:30') at time zone test_zone)) then
    raise exception 'FAIL: pause must affect one local day only'; end if;
  update public.room_combinations set activated_at=null where id=combination_id;
  if exists(select 1 from public._active_room_combination(source_id,((monday+1)+time '07:30') at time zone test_zone)) then
    raise exception 'FAIL: legacy plan activated without saving'; end if;
end; $$;
rollback;
select 'PASS: combined counts/strict ratio, capacity and check-in guards, temporary access, pause/resume, time boundaries and legacy safety; rolled back' as result;
