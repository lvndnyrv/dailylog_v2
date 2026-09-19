-- Rollback-safe Group 12c enforcement test.
begin;

do $$
declare
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_profile uuid := gen_random_uuid();
  v_member uuid;
  v_room uuid;
  v_document uuid;
begin
  select id into v_room
    from public.classrooms
   where daycare_id = v_daycare and archived_at is null
   order by name limit 1;
  if v_room is null then raise exception 'Missing demo classroom'; end if;

  insert into auth.users (
    id, instance_id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values (
    v_profile,'00000000-0000-0000-0000-000000000000','authenticated',
    'authenticated','clearance-test@dailylog.invalid','',now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Clearance Test"}',now(),now()
  );
  update public.profiles
     set email = 'clearance-test@dailylog.invalid',
         full_name = 'Rollback Clearance Test',
         role = 'educator',
         daycare_id = v_daycare,
         classroom_id = v_room
   where id = v_profile;
  insert into public.staff_members (
    daycare_id,profile_id,status,background_check_required
  ) values (v_daycare,v_profile,'active',true)
  returning id into v_member;

  insert into public.staff_credentials (
    daycare_id,staff_member_id,name,required
  ) values (v_daycare,v_member,'Background check',true);

  if public.staff_is_ratio_eligible(v_member) then
    raise exception 'FAIL: missing original counted toward room ratio';
  end if;

  insert into public.documents (
    daycare_id,profile_id,title,category,storage_path,mime_type,size_bytes,
    uploaded_by
  ) values (
    v_daycare,v_profile,'Rollback clearance original','staff_credential_renewal',
    'test/clearance/'||gen_random_uuid()::text,'application/pdf',100,v_profile
  ) returning id into v_document;
  update public.staff_credentials
     set completed_on = current_date,
         expires_on = current_date + 365,
         document_id = v_document
   where staff_member_id = v_member;

  if not public.staff_is_ratio_eligible(v_member) then
    raise exception 'FAIL: approved current original did not clear restriction';
  end if;

  update public.staff_credentials
     set completed_on = current_date - 365,
         expires_on = current_date - 2
   where staff_member_id = v_member;
  if public.staff_is_ratio_eligible(v_member) then
    raise exception 'FAIL: expired clearance counted toward room ratio';
  end if;

  begin
    update public.staff_credentials
       set archived_at = now(), required = false
     where staff_member_id = v_member;
    raise exception 'FAIL: invite-required clearance was removable';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

rollback;
select 'PASS: Group 12 invite clearance survives acceptance, protects the checklist, and gates ratio eligibility' as result;
