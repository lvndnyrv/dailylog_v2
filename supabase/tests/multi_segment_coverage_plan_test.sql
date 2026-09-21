begin;
set local statement_timeout='30s';
do $$
declare
  center uuid:='10000000-0000-4000-a000-000000000001'; owner_id uuid:='00000000-0000-4000-a000-000000000001';
  source uuid; target uuid; people uuid[]:=array[gen_random_uuid(),gen_random_uuid()]; members uuid[]:='{}';
  kids uuid[]:='{}'; kid uuid; p uuid; m uuid; day date:=current_date+20; x record; cover uuid; break_shift uuid; report uuid; third_room uuid; move_id uuid; plan uuid:=gen_random_uuid(); failed_plan uuid:=gen_random_uuid(); segments jsonb; ids uuid[]; repeated uuid[]; before_count integer; first_alert_count integer;
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
    insert into public.children(daycare_id,classroom_id,first_name,last_name,enrolled_on) values(center,source,'Rollback forecast '||i,'Child',current_date) returning id into kid;
    kids:=array_append(kids,kid);
  end loop;
  perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;

  perform public.save_attendance_bookings(day,jsonb_build_array(
    jsonb_build_object('child_id',kids[1],'state','expected','arrives_at','08:00','leaves_at','16:00'),
    jsonb_build_object('child_id',kids[2],'state','expected','arrives_at','08:00','leaves_at','16:00'),
    jsonb_build_object('child_id',kids[3],'state','expected','arrives_at','09:00','leaves_at','12:00')));
  reset role;
  update public.classrooms set lead_educator_id=people[2] where id=target;
  select count(*) into before_count from public.notifications where daycare_id=center;
  set local role authenticated;
  -- Both educators are individually spare, but lending both would deplete source.
  begin
    perform public.save_room_coverage_plan(failed_plan,target,day,jsonb_build_array(
      jsonb_build_object('profile_id',people[1],'start','12:00','end','14:00','confirm',false),
      jsonb_build_object('profile_id',people[2],'start','12:00','end','14:00','confirm',false)));
    raise exception 'FAIL: unsafe simultaneous loans saved';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  if exists(select 1 from public.room_coverage_plans where id=failed_plan) then raise exception 'FAIL: failed batch left plan'; end if;
  if exists(select 1 from public.room_coverage_assignments where staff_member_id=any(members)) then raise exception 'FAIL: failed batch left assignment'; end if;
  reset role;
  if (select count(*) from public.notifications where daycare_id=center)<>before_count then raise exception 'FAIL: failed batch sent notification'; end if;
  set local role authenticated;
  segments:=jsonb_build_array(
    jsonb_build_object('profile_id',people[1],'start','12:00','end','13:00','confirm',false),
    jsonb_build_object('profile_id',people[2],'start','13:00','end','14:00','confirm',false));
  ids:=public.save_room_coverage_plan(plan,target,day,segments,true);
  if cardinality(ids)<>2 then raise exception 'FAIL: split plan not saved'; end if;
  repeated:=public.save_room_coverage_plan(plan,target,day,segments,true);
  if (select count(*) from public.room_coverage_assignments where plan_id=plan)<>2 then raise exception 'FAIL: retry duplicated assignments'; end if;
  if exists(select 1 from public.get_room_coverage_review(day) where assignment_id=any(ids) and reason is not null) then raise exception 'FAIL: existing assignment conflicted with itself'; end if;
  begin
    perform public.save_room_coverage_plan(plan,target,day,segments,false);
    raise exception 'FAIL: reused request accepted different content';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  reset role;
  if (select count(*) from public.notifications where kind='coverage_plan' and payload->>'planId'=plan::text)<>1 then raise exception 'FAIL: room lead notification not once'; end if;
  if (select count(*) from public.notification_outbox where kind='coverage_assignment' and payload->>'assignmentId'=any(ids::text[]))<>2 then raise exception 'FAIL: educator handoff not queued once per segment'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',people[1],'role','authenticated')::text,true);
  set local role authenticated;
  if (select count(*) from public.get_my_room_coverage())<>1 then raise exception 'FAIL: educator list did not restrict to own invitation'; end if;
  select id into cover from public.get_my_room_coverage();
  begin perform public.respond_to_room_coverage((select id from public.room_coverage_assignments where plan_id=plan and staff_member_id=members[2]),'accepted'); raise exception 'FAIL: educator accepted someone else invitation'; exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform public.respond_to_room_coverage(cover,'accepted');
  perform public.respond_to_room_coverage(cover,'accepted');
  if not exists(select 1 from public.get_my_room_coverage() where status='accepted') then raise exception 'FAIL: acceptance not retained'; end if;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.save_attendance_bookings(day,jsonb_build_array(jsonb_build_object('child_id',kids[3],'state','expected','arrives_at','09:00','leaves_at','15:00')));
  if (select count(*) from public.get_room_coverage_review(day) where assignment_id=any(ids) and reason like 'Source room can no longer%')<>2 then raise exception 'FAIL: changed booking did not flag both loans'; end if;
  reset role;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.enqueue_room_coverage_review_alerts();
  if (select count(*) from public.room_coverage_assignments where id=any(ids) and review_issue like 'Source room can no longer%')<>2 then raise exception 'FAIL: stale assignments were not marked for review'; end if;
  if (select count(*) from public.room_coverage_assignments where id=any(ids) and status in('assigned','accepted'))<>2 then raise exception 'FAIL: background review silently cancelled a commitment'; end if;
  if not exists(select 1 from public.notification_outbox where recipient_id=people[1] and kind='coverage_review' and payload->>'assignmentId'=ids[1]::text) then raise exception 'FAIL: affected educator was not queued a review alert'; end if;
  if not exists(select 1 from public.notification_outbox where recipient_id=owner_id and kind='coverage_review' and payload->>'assignmentId'=ids[1]::text) then raise exception 'FAIL: permitted admin was not queued a review alert'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',people[1],'role','authenticated')::text,true);
  set local role authenticated;
  if not exists(select 1 from public.get_my_room_coverage() where id=ids[1] and review_issue like 'Source room can no longer%') then
    raise exception 'FAIL: educator destination did not explain the stale commitment: %',
      (select coalesce(jsonb_agg(to_jsonb(coverage)), '[]'::jsonb) from public.get_my_room_coverage() coverage);
  end if;
  reset role;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select count(*) into first_alert_count from public.notification_outbox where kind='coverage_review' and payload->>'assignmentId'=any(ids::text[]);
  perform public.enqueue_room_coverage_review_alerts();
  if (select count(*) from public.notification_outbox where kind='coverage_review' and payload->>'assignmentId'=any(ids::text[]))<>first_alert_count then raise exception 'FAIL: unchanged review issue duplicated alerts'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.save_attendance_bookings(day,jsonb_build_array(jsonb_build_object('child_id',kids[3],'state','expected','arrives_at','09:00','leaves_at','12:00')));
  reset role;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.enqueue_room_coverage_review_alerts();
  if exists(select 1 from public.room_coverage_assignments where id=any(ids) and review_issue is not null) then raise exception 'FAIL: resolved coverage review issue was not cleared'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.save_attendance_bookings(day,jsonb_build_array(jsonb_build_object('child_id',kids[3],'state','expected','arrives_at','09:00','leaves_at','15:00')));
  reset role;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.enqueue_room_coverage_review_alerts();
  if (select count(*) from public.room_coverage_assignments where id=any(ids) and review_alert_version=2)<>2 then raise exception 'FAIL: recurring review issue did not advance its alert version'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',people[2],'role','authenticated')::text,true);
  set local role authenticated;
  begin
    perform public.respond_to_room_coverage((select id from public.get_my_room_coverage() where status='assigned'),'accepted');
    raise exception 'FAIL: educator accepted an unsafe changed plan';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  reset role;
  perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  if (select count(*) from public.room_coverage_assignments where plan_id=plan and status in('assigned','accepted'))<>2 then raise exception 'FAIL: review silently cancelled assignment'; end if;
  perform public.save_attendance_bookings(day,jsonb_build_array(jsonb_build_object('child_id',kids[3],'state','expected','arrives_at','09:00','leaves_at','12:00')));
  reset role;
  insert into public.staff_time_off_requests(daycare_id,staff_member_id,starts_on,ends_on,kind,status) values(center,members[1],day,day,'vacation','approved');
  set local role authenticated;
  if not exists(select 1 from public.get_room_coverage_review(day) where profile_id=people[1] and reason is not null) then raise exception 'FAIL: leave change not flagged'; end if;
  reset role;
  delete from public.staff_time_off_requests where staff_member_id=members[1];
  update public.staff_shifts set status='draft' where staff_member_id=members[1];
  set local role authenticated;
  if not exists(select 1 from public.get_room_coverage_review(day) where profile_id=people[1] and reason is not null) then raise exception 'FAIL: removed published shift not flagged'; end if;
  reset role;
  update public.staff_shifts set status='published' where staff_member_id=members[1];
  -- Same educator acknowledgement path used by the mobile client.
  perform set_config('request.jwt.claims',json_build_object('sub',people[2],'role','authenticated')::text,true);
  set local role authenticated;
  select id into cover from public.room_coverage_assignments where plan_id=plan and staff_member_id=members[2];
  perform public.respond_to_room_coverage(cover,'declined');
  perform public.respond_to_room_coverage(cover,'declined');
  reset role;
  if not exists(
    select 1 from public.notification_outbox
     where recipient_id=owner_id
       and kind='coverage_response'
       and payload->>'assignmentId'=cover::text
       and payload->>'response'='declined'
       and payload->>'href' like '/rooms?coverageDate=%'
  ) then raise exception 'FAIL: educator decline was not queued and deep-linked for administrator follow-up'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
  set local role authenticated;
  if not exists(select 1 from public.get_room_coverage_review(day) where profile_id=people[2] and status='declined' and reason like 'Educator declined%') then raise exception 'FAIL: educator decline not surfaced'; end if;
  perform public.cancel_planned_room_coverage(ids[1]);
  perform public.cancel_planned_room_coverage(ids[1]);
  reset role;
  if (select count(*) from public.notifications where kind='coverage_cancelled' and payload->>'assignmentId'=ids[1]::text)<>1 then raise exception 'FAIL: cancellation not once'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',people[1],'role','authenticated')::text,true);
  set local role authenticated;
  begin perform public.save_room_coverage_plan(gen_random_uuid(),target,day,segments,true); raise exception 'FAIL: educator created plan'; exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform public.cancel_planned_room_coverage(ids[2]); raise exception 'FAIL: educator cancelled another assignment'; exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
rollback;
select 'PASS: atomic multi-person plans, retries, source depletion, booking/leave/shift changes, decline, notifications, cancellation and permissions; rolled back' result;
