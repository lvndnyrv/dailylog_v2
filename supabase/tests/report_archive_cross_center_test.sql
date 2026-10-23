-- Requires one linked-development archived report. All fixture writes roll back.
begin;

create function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_archive public.report_exports%rowtype;
  v_owner uuid;
  v_other_center uuid;
  v_other_admin uuid := gen_random_uuid();
begin
  select e.* into v_archive
  from public.report_exports e
  join storage.objects o
    on o.bucket_id = 'report-exports' and o.name = e.storage_path
  where e.storage_path is not null
  order by e.generated_at desc
  limit 1;
  if v_archive.id is null then
    raise exception 'Missing real archived report fixture for cross-center check';
  end if;
  select id into v_owner from public.profiles
  where daycare_id = v_archive.daycare_id and role = 'owner_admin' limit 1;
  if v_owner is null then raise exception 'Missing archive-center owner fixture'; end if;

  insert into public.daycares(name)
  values ('Rollback-only archive isolation center') returning id into v_other_center;
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_other_admin, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'archive-' || v_other_admin || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Archive Admin"}', now(), now()
  );
  update public.profiles set daycare_id = v_other_center, role = 'admin'
  where id = v_other_admin;

  perform pg_temp.impersonate('authenticated', v_owner);
  if not exists (select 1 from public.report_exports where id = v_archive.id)
    or not exists (select 1 from storage.objects
      where bucket_id = 'report-exports' and name = v_archive.storage_path) then
    raise exception 'FAIL: own-center admin cannot read the archived report';
  end if;

  perform pg_temp.impersonate('authenticated', v_other_admin);
  if exists (select 1 from public.report_exports where id = v_archive.id) then
    raise exception 'FAIL: other-center admin can read report metadata';
  end if;
  if exists (select 1 from storage.objects
    where bucket_id = 'report-exports' and name = v_archive.storage_path) then
    raise exception 'FAIL: other-center admin can read archived Storage object';
  end if;
end $$;

rollback;
select 'PASS: own-center admin sees real archive; other-center admin sees neither record nor Storage object' as result;
