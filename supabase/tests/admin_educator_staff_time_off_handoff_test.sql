-- Cross-app invariant: educator requests reach staff approvers, educator cannot
-- approve their own request, and the owner's decision returns to the educator.

begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user_id,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
end;
$$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_restricted uuid := '00000000-0000-4000-a000-000000000008';
  v_request uuid;
  v_daycare uuid;
  v_role uuid;
  v_starts_on date := public.center_today() + 45;
  v_ends_on date := public.center_today() + 46;
  v_count integer;
begin
  perform pg_temp.impersonate('postgres');
  select daycare_id into v_daycare from public.profiles where id = v_owner;
  insert into public.center_roles (daycare_id, name, base_role, permissions)
  values (
    v_daycare,
    'Rollback-only no time-off approval',
    'admin',
    '{"staff":{"view":true,"edit":false,"approve":false}}'
  ) returning id into v_role;
  update public.profiles
     set role = 'admin', center_role_id = v_role, archived_at = null
   where id = v_restricted;

  perform pg_temp.impersonate('authenticated', v_educator);
  v_request := public.request_time_off(
    v_starts_on,
    v_ends_on,
    'personal',
    'Admin and educator handoff verification'
  );

  if not exists (
    select 1
      from public.staff_time_off_requests request
     where request.id = v_request
       and request.status = 'pending'
       and request.staff_member_id = public.my_staff_member_id()
  ) then
    raise exception 'FAIL: educator request was not recorded';
  end if;

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1
      from public.notifications notification
     where notification.profile_id = v_owner
       and notification.kind = 'time_off_request'
       and notification.payload ->> 'requestId' = v_request::text
       and notification.payload ->> 'href' = '/staff?tab=time-off'
  ) then
    raise exception 'FAIL: owner did not receive a routable time-off alert';
  end if;
  if exists (
    select 1
      from public.notifications notification
     where notification.profile_id = v_restricted
       and notification.kind = 'time_off_request'
       and notification.payload ->> 'requestId' = v_request::text
  ) then
    raise exception 'FAIL: restricted admin received an unusable time-off review alert';
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  begin
    update public.staff_time_off_requests
       set status = 'approved',
           reviewed_by = v_educator,
           reviewed_at = now()
     where id = v_request;
    raise exception 'FAIL: educator approved their own time-off request';
  exception
    when insufficient_privilege then
      null;
  end;

  perform pg_temp.impersonate('authenticated', v_owner);
  update public.staff_time_off_requests
     set status = 'approved',
         reviewed_by = v_owner,
         reviewed_at = now()
   where id = v_request
     and status = 'pending';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'FAIL: owner could not approve the educator request';
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  if not exists (
    select 1
      from public.notifications notification
     where notification.profile_id = v_educator
       and notification.kind = 'time_off'
       and notification.payload ->> 'requestId' = v_request::text
       and notification.payload ->> 'status' = 'approved'
  ) then
    raise exception 'FAIL: educator did not receive the approval decision';
  end if;

  raise notice 'PASS: educator request, owner review, and educator decision notification are intact';
end;
$$;

rollback;

select 'ADMIN/EDUCATOR STAFF TIME-OFF HANDOFF TESTS: ALL PASSED' as result;
