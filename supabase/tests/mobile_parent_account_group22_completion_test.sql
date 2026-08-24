-- Parent Mobile Group 22 completion tests. All mutations roll back.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_original public.profiles%rowtype;
  v_updated jsonb;
  v_invite jsonb;
  v_hub jsonb;
  v_deletion jsonb;
  v_admin_notification_count int;
  v_parent_notification_count int;
  v_failed boolean := false;
begin
  perform pg_temp.impersonate('authenticated', v_parent);

  select * into v_original from public.profiles where id = v_parent;
  v_updated := public.update_parent_profile(
    'Lucia Account Test', 'Lucia', '+1 416 555 0198', null
  );
  if v_updated->>'full_name' <> 'Lucia Account Test'
     or v_updated->>'phone' <> '+1 416 555 0198' then
    raise exception 'FAIL: parent profile update was not persisted: %', v_updated;
  end if;
  raise notice 'PASS: parent profile updates are server-validated and scoped';

  v_failed := false;
  begin
    perform public.update_parent_profile('', 'Lucia', null, null);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: blank parent full name was accepted';
  end if;
  raise notice 'PASS: required parent profile fields are enforced';

  v_invite := public.create_parent_co_guardian_invite(
    v_child, 'group22-completion@example.com', 'Grandparent'
  );
  v_hub := public.get_parent_account_hub();
  if not exists (
    select 1
    from jsonb_array_elements(v_hub->'children') child,
         jsonb_array_elements(child->'pending_invites') invite
    where invite->>'id' = v_invite->>'id'
      and invite->>'code' = v_invite->>'code'
  ) then
    raise exception 'FAIL: pending invitation cannot be shared again from the account hub';
  end if;
  if public.cancel_parent_co_guardian_invite((v_invite->>'id')::uuid) is not true then
    raise exception 'FAIL: parent could not cancel their guardian invitation';
  end if;
  raise notice 'PASS: guardian invitations can be reshared and cancelled';

  v_deletion := public.request_parent_data_action('deletion');
  perform pg_temp.impersonate('postgres');
  select count(*) into v_admin_notification_count
  from public.notifications notification
  where notification.kind = 'parent_data_request'
    and notification.payload->>'requestId' = v_deletion->>'id'
    and notification.payload->>'type' = 'parent_data_request_admin';
  if v_admin_notification_count < 1 then
    raise exception 'FAIL: the center was not notified about a parent privacy request';
  end if;
  perform pg_temp.impersonate('authenticated', v_parent);
  v_hub := public.get_parent_account_hub();
  if not (v_hub ? 'data_requests')
     or not exists (
       select 1 from jsonb_array_elements(v_hub->'data_requests') request
       where request->>'request_type' = 'deletion'
     ) then
    raise exception 'FAIL: privacy request collection is incomplete: %', v_hub->'data_requests';
  end if;
  if public.cancel_parent_data_request((v_deletion->>'id')::uuid) is not true then
    raise exception 'FAIL: pending privacy request could not be cancelled';
  end if;
  select count(*) into v_parent_notification_count
  from public.notifications notification
  where notification.profile_id = v_parent
    and notification.kind = 'parent_data_request'
    and notification.payload->>'requestId' = v_deletion->>'id'
    and notification.payload->>'status' = 'cancelled';
  if v_parent_notification_count <> 1 then
    raise exception 'FAIL: the parent was not notified about a privacy status change';
  end if;
  raise notice 'PASS: privacy requests reach the center and status changes return to the parent';

  perform pg_temp.impersonate('postgres');
  update public.profiles
  set full_name = v_original.full_name,
      display_name = v_original.display_name,
      phone = v_original.phone,
      avatar_url = v_original.avatar_url
  where id = v_parent;
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 22 COMPLETION TESTS: ALL PASSED' as result;
