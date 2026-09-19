-- Educator daily-log publication and family notification are atomic,
-- permission-scoped and retry-safe. All fixtures roll back.
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
  parent_id uuid := gen_random_uuid();
  room_id uuid;
  child_id uuid;
  log_id uuid;
  future_log_id uuid;
  first_sent_at timestamptz;
  result jsonb;
  row_count integer;
  failed boolean;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (center, 'Rollback daily-log publication room', 18, 72, 8, 4)
  returning id into room_id;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (educator_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'publish-educator-' || educator_id || '@dailylog.invalid', '', now(),
     '{"provider":"email","providers":["email"]}',
     '{"full_name":"Rollback Publishing Educator"}', now(), now()),
    (parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'publish-parent-' || parent_id || '@dailylog.invalid', '', now(),
     '{"provider":"email","providers":["email"]}',
     '{"full_name":"Rollback Publishing Parent"}', now(), now());
  update public.profiles
     set role = 'educator', daycare_id = center, classroom_id = room_id
   where id = educator_id;
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;
  insert into public.staff_members (
    daycare_id, profile_id, job_title, status, background_check_required
  ) values (center, educator_id, 'Rollback educator', 'active', false);
  insert into public.educator_classrooms(educator_id, classroom_id)
  values (educator_id, room_id);

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Publication', 'Child', public.center_today() - 1200,
    public.center_today()
  ) returning id into child_id;
  insert into public.parent_children(parent_id, child_id, relationship, is_primary)
  values (parent_id, child_id, 'Parent', true);
  insert into public.daily_logs (
    daycare_id, child_id, educator_id, log_date, moods, notes
  ) values (
    center, child_id, educator_id, public.center_today(), array['happy'],
    'Settled well and enjoyed outdoor play.'
  ) returning id into log_id;
  insert into public.daily_logs (
    daycare_id, child_id, educator_id, log_date, notes
  ) values (
    center, child_id, educator_id, public.center_today() + 1, 'Future draft'
  ) returning id into future_log_id;

  perform pg_temp.impersonate('authenticated', educator_id);
  result := public.publish_daily_log(log_id);
  first_sent_at := (result->>'sentAt')::timestamptz;
  if first_sent_at is null or not exists (
    select 1 from public.daily_logs daily_log
     where daily_log.id = log_id
       and daily_log.sent_to_parents
       and daily_log.sent_at = first_sent_at
  ) then raise exception 'FAIL: daily log was not finalized'; end if;
  perform pg_temp.impersonate('postgres', owner_id);
  if not exists (
    select 1 from public.notification_outbox outbox
     where outbox.recipient_id = parent_id
       and outbox.kind = 'daily_log'
       and outbox.dedupe_key = 'daily-log:' || child_id || ':' || public.center_today()
       and outbox.payload->>'dailyLogId' = log_id::text
       and outbox.payload->>'childId' = child_id::text
       and outbox.payload->>'logDate' = public.center_today()::text
  ) then
    raise exception 'FAIL: family delivery was not queued with a routable payload (result %, rows %)',
      result,
      (select coalesce(jsonb_agg(to_jsonb(outbox)), '[]'::jsonb)
         from public.notification_outbox outbox
        where outbox.recipient_id = parent_id);
  end if;

  perform pg_temp.impersonate('authenticated', educator_id);
  result := public.publish_daily_log(log_id);
  if (result->>'sentAt')::timestamptz <> first_sent_at then
    raise exception 'FAIL: retry changed the original publication time';
  end if;
  perform pg_temp.impersonate('postgres', owner_id);
  select count(*) into row_count from public.notification_outbox outbox
   where outbox.dedupe_key = 'daily-log:' || child_id || ':' || public.center_today();
  if row_count <> 1 then raise exception 'FAIL: retry left % delivery rows', row_count; end if;

  perform pg_temp.impersonate('authenticated', educator_id);
  failed := false;
  begin
    perform public.publish_daily_log(future_log_id);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: educator published a future daily log'; end if;

  perform pg_temp.impersonate('authenticated', parent_id);
  failed := false;
  begin
    perform public.publish_daily_log(log_id);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: parent invoked staff publication'; end if;
end;
$$;

rollback;
select 'PASS: daily-log finalization and family delivery commit together, retries deduplicate, and parent/future publication is denied; rolled back' result;
