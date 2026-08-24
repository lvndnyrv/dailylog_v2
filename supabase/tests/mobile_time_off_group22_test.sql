-- Group 22 security and workflow smoke tests. Requires the Group 22 demo seed.
begin;

create or replace function pg_temp.impersonate(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_maria uuid := '00000000-0000-4000-a000-000000000003';
  v_other_educator uuid := '00000000-0000-4000-a000-000000000004';
  v_declined uuid := '54300000-0000-4000-a000-000000000002';
  v_pending uuid := '54300000-0000-4000-a000-000000000003';
  v_status jsonb;
  v_new uuid;
  v_failed boolean := false;
  v_today date := public.center_today();
begin
  if public.mobile_workdays_between(date '2026-08-03', date '2026-08-09') <> 5 then
    raise exception 'FAIL: workday calculation did not exclude the weekend';
  end if;

  perform pg_temp.impersonate(v_maria);
  v_status := public.get_mobile_time_off_status();
  if jsonb_array_length(v_status -> 'requests') < 3
     or (v_status ->> 'remainingDays')::integer < 1 then
    raise exception 'FAIL: educator decision list or leave balance is incomplete: %', v_status;
  end if;
  raise notice 'PASS: educator sees approved, declined and pending requests with a live balance';

  perform pg_temp.as_postgres();
  perform pg_temp.impersonate(v_other_educator);
  begin
    perform public.withdraw_mobile_time_off_request(v_pending);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: unrelated educator withdrew another staff request';
  end if;
  raise notice 'PASS: educator request mutations are owner-scoped';

  perform pg_temp.as_postgres();
  perform pg_temp.impersonate(v_maria);
  perform public.withdraw_mobile_time_off_request(v_pending);
  if (select status from public.staff_time_off_requests where id = v_pending) <> 'cancelled' then
    raise exception 'FAIL: pending withdrawal was not persisted';
  end if;
  raise notice 'PASS: educator can withdraw a pending request';

  v_new := public.rerequest_mobile_time_off(
    v_declined,
    v_today + 70,
    v_today + 71,
    'vacation',
    'Replacement dates from Group 22 test'
  );
  if not exists (
    select 1 from public.staff_time_off_requests
     where id = v_new and replaces_request_id = v_declined and status = 'pending'
  ) then
    raise exception 'FAIL: replacement request did not retain its audit link';
  end if;
  raise notice 'PASS: educator can re-request a declined request with an audit link';

  perform pg_temp.as_postgres();
  perform pg_temp.impersonate(v_owner);
  update public.staff_time_off_requests
     set status = 'approved',
         decision_notes = 'Approved in the Group 22 test',
         reviewed_by = v_owner,
         reviewed_at = now()
   where id = v_new and status = 'pending';

  -- Inspect delivery rows as postgres. The owner can read center outbox history,
  -- but notifications intentionally remain visible only to their recipient.
  perform pg_temp.as_postgres();

  if not exists (
    select 1 from public.notification_outbox outbox
     where outbox.recipient_id = v_maria
       and outbox.kind = 'time_off'
       and outbox.payload ->> 'requestId' = v_new::text
       and outbox.payload ->> 'screen' = 'TimeOffDetail'
  ) then
    raise exception 'FAIL: decision push was not queued with its detail deep link';
  end if;
  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_maria
       and notification.kind = 'time_off'
       and notification.payload ->> 'requestId' = v_new::text
  ) then
    raise exception 'FAIL: decision was not written to the in-app notification history';
  end if;
  raise notice 'PASS: admin decision queues push and in-app notification records';
end;
$$;

rollback;
select 'MOBILE GROUP 22 TESTS: ALL PASSED' as result;
