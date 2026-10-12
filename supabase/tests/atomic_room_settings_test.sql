-- Shared-project regression: every fixture/change is rolled back.
begin;
create function pg_temp.impersonate(p_role text, p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role','postgres',true);
  perform set_config('role',p_role,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role',p_role)::text,true);
end; $$;
create function pg_temp.reject_room(p_id uuid,p_data jsonb,p_version timestamptz,p_error text)
returns void language plpgsql as $$
begin
  perform public.save_room_settings(p_id,p_data,p_version);
  raise exception 'FAIL: expected rejection: %',p_error;
exception when others then
  if sqlerrm like 'FAIL:%' or sqlerrm not ilike '%'||p_error||'%' then raise; end if;
end; $$;
do $$
<<atomic_room_settings_test>>
declare
  center_id uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  home_id uuid := '20000000-0000-4000-a000-000000000001';
  educator_id uuid := gen_random_uuid(); staff_id uuid; room_id uuid; room_version timestamptz;
  role_id uuid; foreign_center uuid; data jsonb; original jsonb; before_count integer;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(educator_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'room-settings-'||educator_id||'@dailylog.invalid','',now(),
    '{"provider":"email","providers":["email"]}','{"full_name":"Rollback room lead"}',now(),now());
  update public.profiles set role='educator',daycare_id=center_id,classroom_id=home_id where id=educator_id;
  insert into public.staff_members(daycare_id,profile_id,status) values(center_id,educator_id,'active') returning id into staff_id;
  data := jsonb_build_object('name','Rollback future room','age_group','Custom',
    'min_age_months','24','max_age_months','48','capacity','12','ratio','4',
    'opens_on',(current_date+30)::text,'nap_start','12:00','nap_end','14:00','lead_educator_id',educator_id);
  perform pg_temp.impersonate('authenticated',owner_id);
  select count(*) into before_count from public.classrooms;
  perform pg_temp.reject_room(null,data||'{"lead_educator_id":"00000000-0000-4000-a000-000000000001"}',null,'active educator');
  if (select count(*) from public.classrooms) <> before_count then raise exception 'FAIL: rejected lead left a partial room'; end if;
  room_id := public.save_room_settings(null,data);
  select updated_at,to_jsonb(r) into room_version,original from public.classrooms r where id=room_id;
  if (select lead_educator_id from public.classrooms where id=room_id) is distinct from educator_id then raise exception 'FAIL: lead not saved'; end if;
  if (select classroom_id from public.profiles where id=educator_id) is distinct from home_id
    or exists(select 1 from public.educator_classrooms where educator_classrooms.educator_id=atomic_room_settings_test.educator_id) then
    raise exception 'FAIL: selecting lead changed home/access';
  end if;
  perform pg_temp.reject_room(null,data,null,'already uses');
  perform pg_temp.reject_room(room_id,data||'{"name":" "}',room_version,'Room name');
  perform pg_temp.reject_room(room_id,data||'{"capacity":"0"}',room_version,'whole numbers');
  perform pg_temp.reject_room(room_id,data||'{"ratio":"1.5"}',room_version,'whole numbers');
  perform pg_temp.reject_room(room_id,data||'{"min_age_months":"-1"}',room_version,'whole numbers');
  perform pg_temp.reject_room(room_id,data||'{"max_age_months":"24"}',room_version,'Oldest age');
  perform pg_temp.reject_room(room_id,data||'{"nap_end":""}',room_version,'both nap times');
  perform pg_temp.reject_room(room_id,data||'{"nap_end":"11:00"}',room_version,'both nap times');
  perform pg_temp.reject_room(room_id,data,null,'changed while');
  perform pg_temp.reject_room(room_id,data,room_version-interval '1 second','changed while');
  perform pg_temp.reject_room(gen_random_uuid(),data,room_version,'unavailable');
  if (select to_jsonb(r) from public.classrooms r where id=room_id) is distinct from original then raise exception 'FAIL: failed update partially saved'; end if;

  perform pg_temp.impersonate('postgres',owner_id);
  update public.staff_members set status='inactive' where id=staff_id;
  perform pg_temp.impersonate('authenticated',owner_id);
  perform pg_temp.reject_room(room_id,data,room_version,'active educator');
  perform pg_temp.impersonate('postgres',owner_id);
  update public.staff_members set status='active' where id=staff_id;
  insert into public.daycares(name) values('Rollback foreign room center') returning id into foreign_center;
  update public.profiles set daycare_id=foreign_center where id=educator_id;
  perform pg_temp.impersonate('authenticated',owner_id);
  perform pg_temp.reject_room(room_id,data,room_version,'active educator');
  perform pg_temp.impersonate('postgres',owner_id);
  update public.profiles set daycare_id=center_id, classroom_id=home_id where id=educator_id;
  perform pg_temp.impersonate('authenticated',educator_id);
  perform pg_temp.reject_room(null,data,null,'permission');
  perform pg_temp.impersonate('postgres',owner_id);
  insert into public.center_roles(daycare_id,name,base_role,permissions)
  values(center_id,'Rollback room viewer','admin','{"daily_logs":{"view":true,"edit":false}}') returning id into role_id;
  update public.profiles set role='admin',center_role_id=role_id where id=educator_id;
  perform pg_temp.impersonate('authenticated',educator_id);
  perform pg_temp.reject_room(null,data,null,'permission');
  perform pg_temp.impersonate('authenticated',owner_id);
  perform public.save_room_settings(room_id,data||'{"name":"Rollback updated room","lead_educator_id":"","nap_start":"","nap_end":""}',room_version);
  if (select lead_educator_id is not null or nap_start is not null or name <> 'Rollback updated room' from public.classrooms where id=room_id) then
    raise exception 'FAIL: clearing lead/nap settings failed';
  end if;
  perform pg_temp.impersonate('postgres',owner_id);
  update public.classrooms set archived_at=now() where id=room_id;
  perform pg_temp.impersonate('authenticated',owner_id);
  perform pg_temp.reject_room(room_id,data,room_version,'unavailable');
  raise notice 'PASS: atomic room settings, validation, lead designation, stale edits and permissions';
end $$;
rollback;
