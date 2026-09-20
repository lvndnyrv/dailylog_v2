-- Empty daily drafts cannot become final family recaps. Fixtures roll back.
begin;
set local statement_timeout = '30s';

create function pg_temp.impersonate(p_role text, p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  center uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  educator_id uuid := gen_random_uuid();
  room_id uuid;
  child_id uuid;
  log_id uuid;
  failed boolean := false;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (center, 'Rollback daily report readiness', 18, 72, 8, 4)
  returning id into room_id;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    educator_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'readiness-' || educator_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Readiness Educator"}', now(), now()
  );
  update public.profiles
     set role = 'educator', daycare_id = center, classroom_id = room_id
   where id = educator_id;
  insert into public.staff_members (
    daycare_id, profile_id, job_title, status, background_check_required
  ) values (center, educator_id, 'Rollback educator', 'active', false);
  insert into public.educator_classrooms(educator_id, classroom_id)
  values (educator_id, room_id);

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Readiness', 'Child', public.center_today() - 1200,
    public.center_today()
  ) returning id into child_id;
  insert into public.daily_logs (
    daycare_id, child_id, educator_id, log_date
  ) values (
    center, child_id, educator_id, public.center_today()
  ) returning id into log_id;

  perform pg_temp.impersonate('authenticated', educator_id);
  begin
    perform public.publish_daily_log(log_id);
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: empty draft was published';
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.activity_entries(daily_log_id, activity_name)
  values (log_id, 'Outdoor play'), (log_id, 'Story time');

  perform pg_temp.impersonate('authenticated', educator_id);
  perform public.publish_daily_log(log_id);
  if not exists (
    select 1 from public.daily_logs daily_log
     where daily_log.id = log_id
       and daily_log.sent_to_parents
       and daily_log.sent_at is not null
  ) then
    raise exception 'FAIL: meaningful report was not published';
  end if;
end;
$$;

rollback;
select 'PASS: empty daily drafts stay private and meaningful reports can be finalized; rolled back' result;

