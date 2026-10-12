-- All data, notifications and staffing effects roll back on the shared project.
begin;
create function pg_temp.impersonate(p_role text,p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role','postgres',true); perform set_config('role',p_role,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role',p_role)::text,true);
end; $$;
do $$
declare
  center uuid:='10000000-0000-4000-a000-000000000001'; owner_id uuid:='00000000-0000-4000-a000-000000000001';
  source uuid; target uuid; candidate uuid; occupant uuid; future_child uuid; offer uuid; parent_id uuid:=gen_random_uuid();
  plan_id uuid; version timestamptz; move_day date; today date; settings jsonb; n integer; notice_count integer;
begin
  perform pg_temp.impersonate('postgres',owner_id);
  today:=public.center_today(); move_day:=public.next_center_open_date(center,today+6);
  insert into public.classrooms(daycare_id,name,min_age_months,max_age_months,capacity,ratio_children_per_educator)
    values(center,'Rollback transition source',0,120,10,4) returning id into source;
  insert into public.classrooms(daycare_id,name,min_age_months,max_age_months,capacity,ratio_children_per_educator,opens_on)
    values(center,'Rollback transition destination',36,72,2,4,move_day) returning id into target;
  insert into public.children(daycare_id,classroom_id,first_name,last_name,date_of_birth)
    values(center,source,'Transition','Candidate',(today-interval '4 years')::date) returning id into candidate;
  insert into public.children(daycare_id,classroom_id,first_name,last_name,date_of_birth)
    values(center,target,'Transition','Occupant',(today-interval '4 years')::date) returning id into occupant;
  insert into public.children(daycare_id,classroom_id,first_name,last_name,date_of_birth,enrolled_on)
    values(center,target,'Transition','Future',(today-interval '4 years')::date,move_day+14) returning id into future_child;
  insert into public.enrollments(daycare_id,classroom_id,child_first_name,stage,offer_status,desired_start_date,offer_expires_at)
    values(center,target,'Offer hold','offer','sent',move_day,now()+interval '30 days') returning id into offer;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(parent_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'transition-'||parent_id||'@dailylog.invalid','',now(),'{"provider":"email","providers":["email"]}',
      '{"full_name":"Rollback Transition Parent"}',now(),now());
  update public.profiles set role='parent',daycare_id=center where id=parent_id;
  insert into public.parent_children(parent_id,child_id,relationship,is_primary) values(parent_id,candidate,'Parent',true);

  perform pg_temp.impersonate('authenticated',owner_id);
  if exists(select 1 from public.get_room_transitions(3) where child_id=candidate) then raise exception 'FAIL: fixture is already a birthday candidate'; end if;
  if (select reason from public.preview_room_transition(candidate,target,today) limit 1)<>'Room has not opened yet' then raise exception 'FAIL: opening date ignored'; end if;
  if (select projected_children from public.preview_room_transition(candidate,target,move_day) limit 1)<>2 then raise exception 'FAIL: offers/future start count wrong'; end if;
  settings:=jsonb_build_object('child_id',candidate,'from_room_id',source,'to_room_id',target,'move_on',move_day,'transition_week',false,'new_tuition_cents',118000);
  begin
    perform public.save_room_transition_plan(settings);
    raise exception 'FAIL: full projected room accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  if exists(select 1 from public.room_transition_plans where child_id=candidate) then raise exception 'FAIL: failed save left plan'; end if;

  perform pg_temp.impersonate('postgres',owner_id);
  update public.enrollments set offer_status='withdrawn' where id=offer;
  perform pg_temp.impersonate('authenticated',owner_id);
  if not (select available from public.preview_room_transition(candidate,target,move_day) limit 1) then raise exception 'FAIL: withdrawn offer still held'; end if;
  if (select projected_children from public.preview_room_transition(candidate,target,move_day+14) limit 1)<>2 then raise exception 'FAIL: future start missing'; end if;
  plan_id:=public.save_room_transition_plan(settings);
  select updated_at into version from public.room_transition_plans where id=plan_id;
  if not exists(select 1 from public.get_room_transitions(3) where child_id=candidate and next_room_id=target) then raise exception 'FAIL: saved plan hidden outside birthday horizon'; end if;
  if (select classroom_id from public.children where id=candidate)<>source then raise exception 'FAIL: planning moved child early'; end if;
  perform pg_temp.impersonate('authenticated',parent_id);
  if not exists(select 1 from public.notifications where profile_id=parent_id and payload->>'type'='room_move') then raise exception 'FAIL: family plan notice missing'; end if;
  if not exists(select 1 from jsonb_array_elements(public.get_parent_schedule_hub()->'room_moves') m where m->>'id'=plan_id::text) then raise exception 'FAIL: parent cannot see published plan'; end if;
  perform pg_temp.impersonate('authenticated',owner_id);
  begin
    perform public.save_room_transition_plan(settings||'{"notes":"stale overwrite"}',plan_id,version-interval '1 second');
    raise exception 'FAIL: stale edit accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin
    perform public.complete_reviewed_room_transition(plan_id,version);
    raise exception 'FAIL: early completion accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform pg_temp.impersonate('authenticated',parent_id);
  begin
    perform public.cancel_room_transition_plan(plan_id,version);
    raise exception 'FAIL: parent cancelled admin plan';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform pg_temp.impersonate('authenticated',owner_id);
  perform public.cancel_room_transition_plan(plan_id,version);
  perform pg_temp.impersonate('authenticated',parent_id);
  select count(*) into notice_count from public.notifications where profile_id=parent_id and payload->>'type'='room_move_cancelled';
  if notice_count<>1 then raise exception 'FAIL: cancellation notice missing'; end if;
  if exists(select 1 from jsonb_array_elements(public.get_parent_schedule_hub()->'room_moves') m where m->>'id'=plan_id::text) then raise exception 'FAIL: parent still sees cancelled plan'; end if;
  perform pg_temp.impersonate('authenticated',owner_id);
  perform public.cancel_room_transition_plan(plan_id,version);
  perform pg_temp.impersonate('postgres',owner_id);
  if (select count(*) from public.notifications where profile_id=parent_id and payload->>'type'='room_move_cancelled')<>notice_count then raise exception 'FAIL: retry duplicated cancellation'; end if;
  perform pg_temp.impersonate('authenticated',owner_id);
  if (select classroom_id from public.children where id=candidate)<>source then raise exception 'FAIL: cancellation moved child'; end if;
  if exists(select 1 from public.get_room_transitions(3) where child_id=candidate) then raise exception 'FAIL: cancelled plan still listed'; end if;

  perform pg_temp.impersonate('postgres',owner_id);
  insert into public.child_departures(daycare_id,child_id,last_day,reason,offer_spot_automatically)
    values(center,occupant,move_day-1,'Rollback test',false);
  perform pg_temp.impersonate('authenticated',owner_id);
  select projected_children into n from public.preview_room_transition(candidate,target,move_day) limit 1;
  if n<>0 then raise exception 'FAIL: scheduled departure not reflected: %',n; end if;
  if extract(isodow from today)<=5 and not exists(select 1 from public.center_closures where daycare_id=center and today between starts_on and ends_on) then
    perform pg_temp.impersonate('postgres',owner_id);
    update public.classrooms set opens_on=today where id=target;
    perform pg_temp.impersonate('authenticated',owner_id);
    plan_id:=public.save_room_transition_plan(settings||jsonb_build_object('move_on',today));
    select updated_at into version from public.room_transition_plans where id=plan_id;
    begin
      perform public.complete_reviewed_room_transition(plan_id,version-interval '1 second');
      raise exception 'FAIL: stale completion accepted';
    exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
    begin
      perform public.complete_reviewed_room_transition(plan_id,version);
      raise exception 'FAIL: actual enrollment capacity was not rechecked';
    exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
    perform pg_temp.impersonate('postgres',owner_id);
    update public.children set classroom_id=source where id=future_child;
    perform pg_temp.impersonate('authenticated',owner_id);
    perform public.complete_reviewed_room_transition(plan_id,version);
    perform public.complete_reviewed_room_transition(plan_id,version);
    if (select classroom_id from public.children where id=candidate)<>target then raise exception 'FAIL: completion did not move child'; end if;
    perform pg_temp.impersonate('authenticated',parent_id);
    if not exists(select 1 from jsonb_array_elements(public.get_parent_schedule_hub()->'room_moves') m where m->>'id'=plan_id::text and m->>'status'='completed') then raise exception 'FAIL: parent completion status missing'; end if;
  end if;
end $$;
rollback;
select 'PASS: dated capacity, offers, future starts, departures, plan visibility, stale edits, family notices, cancellation and permission guards; rolled back' as result;
