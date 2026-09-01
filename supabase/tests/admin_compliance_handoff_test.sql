-- Rollback-safe permissions, expiration and notification tests. No credentials
-- or real document bytes are copied. Run with supabase db query --linked --file.
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
  v_staff uuid:='00000000-0000-4000-a000-000000000008';
  v_daycare uuid;v_other uuid;v_doc uuid;v_role uuid;v_share jsonb;v_count integer;
begin
  select daycare_id into v_daycare from public.profiles where id=v_owner;
  if v_daycare is null then raise exception 'Missing dev owner fixture'; end if;
  perform pg_temp.impersonate('postgres');
  insert into public.daycares(name) values('Rollback-only compliance isolation center') returning id into v_other;
  insert into public.compliance_documents(daycare_id,title,category,storage_path,mime_type,size_bytes,uploaded_by,watch_expiry)
    values(v_other,'Private other-center record','other','test/'||gen_random_uuid()::text,'application/pdf',100,v_owner,false) returning id into v_doc;
  perform pg_temp.impersonate('authenticated',v_owner);
  if exists(select 1 from public.compliance_documents where id=v_doc) then raise exception 'FAIL: cross-center document visible'; end if;
  if not public.can_access_compliance(true) then raise exception 'FAIL: owner cannot manage compliance'; end if;
  perform pg_temp.expect_denied('select public._compliance_inspection_pack('''||v_other||''')');
  v_share:=public.create_compliance_inspection_share('Rollback-only expiration test');
  perform pg_temp.impersonate('anon');
  if public.read_compliance_inspection_share(v_share->>'token')->>'center_name' is null then raise exception 'FAIL: valid share unavailable'; end if;
  perform pg_temp.expect_denied(format('select public.read_compliance_inspection_share(%L,%L)',v_share->>'token',v_doc));
  perform pg_temp.expect_denied(format('select public._read_compliance_inspection_share(%L)',v_share->>'token'));
  perform pg_temp.impersonate('postgres');
  update public.compliance_inspection_shares set expires_at=now()-interval '1 second' where id=(v_share->>'id')::uuid;
  perform pg_temp.impersonate('anon');
  perform pg_temp.expect_denied(format('select public.read_compliance_inspection_share(%L)',v_share->>'token'));
  perform pg_temp.impersonate('authenticated',v_owner);
  v_share:=public.create_compliance_inspection_share('Rollback-only creator access test');
  perform pg_temp.impersonate('postgres');
  update public.profiles set archived_at=now() where id=v_owner;
  perform pg_temp.impersonate('anon');
  perform pg_temp.expect_denied(format('select public.read_compliance_inspection_share(%L)',v_share->>'token'));
  perform pg_temp.impersonate('authenticated',v_owner);
  if public.can_access_compliance() then raise exception 'FAIL: archived admin retains compliance access'; end if;
  perform pg_temp.impersonate('postgres');
  update public.profiles set archived_at=null where id=v_owner;
  insert into public.center_roles(daycare_id,name,base_role,permissions)
    values(v_daycare,'Rollback-only restricted admin','admin','{"staff":{"view":false}}') returning id into v_role;
  update public.profiles set role='admin',center_role_id=v_role where id=v_staff;
  perform pg_temp.impersonate('authenticated',v_staff);
  if public.can_access_compliance() then raise exception 'FAIL: restricted role bypasses staff-file permission'; end if;
  perform pg_temp.expect_denied('select public.get_compliance_inspection_pack()');
  perform pg_temp.expect_denied('select public.create_compliance_inspection_share(''Forbidden'')');
  if exists(select 1 from public.list_compliance_due_items()) then raise exception 'FAIL: restricted role sees deadline previews'; end if;
  perform pg_temp.impersonate('postgres');
  update public.center_roles set permissions='{"reports":{"edit":false}}' where id=v_role;
  perform pg_temp.impersonate('authenticated',v_staff);
  if not public.can_access_compliance() or public.can_access_compliance(true) then raise exception 'FAIL: read-only reporting permission is not respected'; end if;
  perform pg_temp.expect_denied('select public.create_compliance_inspection_share(''Forbidden'')');
  perform pg_temp.impersonate('postgres');
  update public.center_roles set permissions='{}' where id=v_role;
  perform pg_temp.impersonate('authenticated',v_staff);
  v_share:=public.create_compliance_inspection_share('Rollback-only permission removal');
  perform pg_temp.impersonate('postgres');
  update public.center_roles set permissions='{"staff":{"view":false}}' where id=v_role;
  perform pg_temp.impersonate('anon');
  perform pg_temp.expect_denied(format('select public.read_compliance_inspection_share(%L)',v_share->>'token'));
  perform pg_temp.impersonate('postgres');
  insert into public.compliance_documents(daycare_id,title,category,storage_path,mime_type,size_bytes,uploaded_by,expires_on)
    values(v_daycare,'Rollback-only expiring license','license','test/'||gen_random_uuid()::text,'application/pdf',100,v_owner,current_date+50) returning id into v_doc;
  perform public.enqueue_compliance_due_reminders();
  if not exists(select 1 from public.notifications where profile_id=v_owner and kind='compliance_due' and title like 'Rollback-only expiring%') then
    raise exception 'FAIL: due document reminder missing'; end if;
  if exists(select 1 from public.notifications where profile_id=v_staff and kind='compliance_due' and title like 'Rollback-only expiring%') then
    raise exception 'FAIL: notification leaks a restricted compliance preview'; end if;
  select count(*) into v_count from public.notifications where profile_id=v_owner and kind='compliance_due' and title like 'Rollback-only expiring%';
  perform public.enqueue_compliance_due_reminders();
  if (select count(*) from public.notifications where profile_id=v_owner and kind='compliance_due' and title like 'Rollback-only expiring%')<>v_count then
    raise exception 'FAIL: duplicate expiry reminder'; end if;
end $$;
rollback;
select 'PASS: tenant isolation, source permissions, read-only roles, expired links, creator deactivation, permission removal and reminder deduplication' as result;
