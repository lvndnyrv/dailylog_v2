begin;
set local statement_timeout='30s';
do $$
declare
  center uuid:='10000000-0000-4000-a000-000000000001'; owner_id uuid:='00000000-0000-4000-a000-000000000001';
  source uuid; target uuid; people uuid[]:=array[gen_random_uuid(),gen_random_uuid()]; members uuid[]:='{}';
  kids uuid[]:='{}'; kid uuid; p uuid; m uuid; day date:=current_date+20; x record; cover uuid; break_shift uuid; report uuid; third_room uuid; move_id uuid;
begin
  while extract(isodow from day)>5 loop day:=day+1; end loop;
  update public.daycares set timezone='America/Toronto',opens_at='07:00',closes_at='18:00' where id=center;
  delete from public.center_closures where daycare_id=center;
  insert into public.classrooms(daycare_id,name,capacity,ratio_children_per_educator) values(center,'Rollback forecast source',10,2) returning id into source;
  insert into public.classrooms(daycare_id,name,capacity,ratio_children_per_educator) values(center,'Rollback forecast target',10,3) returning id into target;
  foreach p in array people loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values(p,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','forecast-test-'||p||'@dailylog.invalid','',now(),'{"provider":"email","providers":["email"]}','{"full_name":"Rollback forecast educator"}',now(),now());
    update public.profiles set role='educator',daycare_id=center,classroom_id=source where id=p;
    insert into public.staff_members(daycare_id,profile_id,status) values(center,p,'active') returning id into m;
    members:=array_append(members,m);
    insert into public.staff_shifts(daycare_id,staff_member_id,classroom_id,starts_at,ends_at,status,unpaid_break_minutes)
      values(center,m,source,(day+time '07:00') at time zone 'America/Toronto',(day+time '18:00') at time zone 'America/Toronto','published',0) returning id into break_shift;
  end loop;
  for i in 1..3 loop
    insert into public.children(daycare_id,classroom_id,first_name,last_name,enrolled_on)
      values(center,source,'Rollback forecast '||i,'Child',(now() at time zone 'America/Toronto')::date)
      returning id into kid;
    kids:=array_append(kids,kid);
  end loop;
  perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  if not exists(select 1 from public.get_room_demand_forecast(day) f where f.room_id=source and unknown_bookings=3) then raise exception 'FAIL: missing bookings hidden'; end if;
  select * into x from public.get_coverage_candidates(target,day,'12:00','14:00') where profile_id=people[1];
  if x.available then raise exception 'FAIL: unknown demand allowed a loan'; end if;
  perform public.save_attendance_bookings(day,jsonb_build_array(
    jsonb_build_object('child_id',kids[1],'state','expected','arrives_at','08:00','leaves_at','16:00'),
    jsonb_build_object('child_id',kids[2],'state','expected','arrives_at','08:00','leaves_at','16:00'),
    jsonb_build_object('child_id',kids[3],'state','expected','arrives_at','09:00','leaves_at','12:00')));
  if not exists(select 1 from public.get_room_demand_forecast(day) f where f.room_id=source and f.starts_at=(day+time '09:00') at time zone 'America/Toronto' and expected_children=3 and required_staff=2 and scheduled_staff=2) then raise exception 'FAIL: booking boundary/ratio incorrect'; end if;
  select * into x from public.get_coverage_candidates(target,day,'11:00','14:00') where profile_id=people[1];
  if x.available then raise exception 'FAIL: shortfall in part of interval ignored'; end if;
  select * into x from public.get_coverage_candidates(target,day,'12:00','14:00') where profile_id=people[1];
  if not x.available then raise exception 'FAIL: safely spare educator unavailable: %',x.reason; end if;
  -- A one-minute break must block lending the other educator for the whole interval.
  perform public.set_planned_shift_break(break_shift,'12:01','12:02');
  select * into x from public.get_coverage_candidates(target,day,'12:00','14:00') where profile_id=people[1];
  if x.available then raise exception 'FAIL: one-minute break gap missed'; end if;
  perform public.set_planned_shift_break(break_shift,null,null);
  cover:=public.assign_planned_room_coverage(people[1],target,day,'12:00','14:00');
  if not exists(select 1 from public.get_room_demand_forecast(day) f where f.room_id=target and f.starts_at=(day+time '12:00') at time zone 'America/Toronto' and scheduled_staff=0 and pending_staff=1) then raise exception 'FAIL: pending loan counted as confirmed'; end if;
  select * into x from public.get_coverage_candidates(target,day,'12:00','14:00') where profile_id=people[2];
  if x.available then raise exception 'FAIL: second loan depleted source'; end if;
  update public.room_coverage_assignments set status='accepted' where id=cover;
  if not exists(select 1 from public.get_room_demand_forecast(day) f where f.room_id=target and f.starts_at=(day+time '12:00') at time zone 'America/Toronto' and scheduled_staff=1 and pending_staff=0) then raise exception 'FAIL: accepted loan missing'; end if;
  update public.room_coverage_assignments set status='cancelled' where id=cover;
  reset role;
  insert into public.parent_absence_reports(daycare_id,child_id,starts_on,ends_on,reason,reported_by) values(center,kids[3],day,day,'sick',owner_id) returning id into report;
  set local role authenticated;
  if exists(select 1 from public.get_room_demand_forecast(day) f where f.room_id=source and expected_children>2) then raise exception 'FAIL: active absence not applied'; end if;
  reset role;
  update public.parent_absence_reports set status='cancelled' where id=report;
  set local role authenticated;
  if not exists(select 1 from public.get_room_demand_forecast(day) f where f.room_id=source and expected_children=3) then raise exception 'FAIL: cancelling absence did not restore demand'; end if;
  begin perform public.save_attendance_bookings(day,jsonb_build_array(jsonb_build_object('child_id',kids[1],'state','expected','arrives_at','06:00','leaves_at','16:00'))); raise exception 'FAIL: out-of-hours booking accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  reset role;
  -- Immediate loans must use actual attendance even if the dated plan is lower.
  update public.daycares set time_tracking_enabled=false,ratio_block_checkins=false where id=center;
  foreach kid in array kids loop
    insert into public.attendance_records(daycare_id,child_id,date,checked_in_at,checked_in_by,method,status)
      values(center,kid,(now() at time zone 'America/Toronto')::date,now()-interval '5 minutes',owner_id,'educator','present');
  end loop;
  if public._loan_live_source_safe(members[1],source) then raise exception 'FAIL: actual attendance shortfall allowed immediate loan'; end if;
  update public.attendance_records set checked_out_at=now() where child_id=kids[3];
  if not public._loan_live_source_safe(members[1],source) then raise exception 'FAIL: actual spare staff not recognized'; end if;
  -- Forecasts cross combination boundaries once, using the stricter ratio.
  set local role authenticated;
  perform public.save_room_combinations(jsonb_build_array(
    jsonb_build_object('period','morning','source_classroom_id',source,'host_classroom_id',target,'starts_at','09:00','ends_at','14:00','enabled',true),
    jsonb_build_object('period','evening','starts_at','17:00','ends_at','18:00','enabled',false)));
  if not exists(select 1 from public.get_room_demand_forecast(day) where room_id=target and starts_at=(day+time '09:00') at time zone 'America/Toronto' and expected_children=3 and scheduled_staff=2 and ratio=2) then raise exception 'FAIL: shared host forecast or strict ratio incorrect'; end if;
  if exists(select 1 from public.get_room_demand_forecast(day) where room_id=source and starts_at>=(day+time '09:00') at time zone 'America/Toronto' and starts_at<(day+time '14:00') at time zone 'America/Toronto') then raise exception 'FAIL: combined source double counted'; end if;
  select * into x from public.get_coverage_candidates(target,day,'12:00','14:00') where profile_id=people[1];
  if x.available then raise exception 'FAIL: lending within same host reported extra coverage'; end if;
  reset role;
  insert into public.classrooms(daycare_id,name,capacity,ratio_children_per_educator) values(center,'Rollback third forecast room',10,3) returning id into third_room;
  update public.children set classroom_id=target where id=kids[1];
  if not public._can_lend_educator(members[1],third_room,(day+time '12:00') at time zone 'America/Toronto',(day+time '14:00') at time zone 'America/Toronto') then raise exception 'FAIL: spare combined educator not available before partner move'; end if;
  insert into public.room_transition_plans(daycare_id,child_id,from_classroom_id,to_classroom_id,move_on)
    values(center,kids[1],target,third_room,day) returning id into move_id;
  if public._can_lend_educator(members[1],third_room,(day+time '12:00') at time zone 'America/Toronto',(day+time '14:00') at time zone 'America/Toronto') then raise exception 'FAIL: partner-room pending move allowed loan'; end if;
  update public.room_transition_plans set status='cancelled' where id=move_id;
  update public.children set classroom_id=source where id=kids[1];
  update public.room_combinations set paused_on=day where daycare_id=center;
  set local role authenticated;
  if not exists(select 1 from public.get_room_demand_forecast(day) where room_id=source and starts_at=(day+time '09:00') at time zone 'America/Toronto' and expected_children=3) then raise exception 'FAIL: pausing combination failed to restore home forecast'; end if;
  reset role;
  insert into public.center_closures(daycare_id,starts_on,ends_on,reason) values(center,day,day,'Rollback closure');
  set local role authenticated;
  if exists(select 1 from public.get_room_demand_forecast(day)) then raise exception 'FAIL: closure still forecasts staffed rooms'; end if;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',people[1],'role','authenticated')::text,true);
  set local role authenticated;
  begin perform public.save_attendance_bookings(day,'[]'); raise exception 'FAIL: educator edited booking plan';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
rollback;
select 'PASS: bookings, absence/cancellation, exact break boundaries, safe loans, live demand, combined hosts/pause, partner moves, pending reservations, closure and permissions; rolled back' result;
