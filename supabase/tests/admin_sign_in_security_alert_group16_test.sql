begin;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_owner_session uuid := gen_random_uuid();
  v_educator_session uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, user_agent, ip)
  values (v_owner_session, v_owner, now(), now(), 'Group 16 test browser', '192.0.2.16'::inet),
         (v_educator_session, v_educator, now(), now(), 'Group 16 test phone', '192.0.2.17'::inet);

  if not exists (
    select 1 from public.notifications n
     where n.profile_id = v_owner
       and n.kind = 'new_device_sign_in'
       and n.payload ->> 'session_id' = v_owner_session::text
       and n.payload ->> 'href' = '/settings?account=sessions&session=' || v_owner_session::text
  ) then
    raise exception 'FAIL: admin sign-in notice or session deep link missing';
  end if;
  if exists (
    select 1 from public.notifications n
     where n.profile_id = v_educator
       and n.kind = 'new_device_sign_in'
       and n.payload ->> 'session_id' = v_educator_session::text
  ) then
    raise exception 'FAIL: educator was sent admin security notice';
  end if;

  if exists (
    select 1 from public.notification_preferences p
     where p.profile_id = v_owner and p.kind = 'new_device_sign_in' and p.push
  ) and not exists (
    select 1 from public.notification_outbox o
     where o.recipient_id = v_owner and o.channel = 'push'
       and o.dedupe_key = 'admin-sign-in:' || v_owner_session::text
  ) then
    raise exception 'FAIL: opted-in push alert was not queued';
  end if;
  if exists (
    select 1 from public.notification_preferences p
     where p.profile_id = v_owner and p.kind = 'new_device_sign_in' and p.email
  ) and not exists (
    select 1 from public.notification_outbox o
     where o.recipient_id = v_owner and o.channel = 'email'
       and o.dedupe_key = 'admin-sign-in:' || v_owner_session::text
  ) then
    raise exception 'FAIL: opted-in email alert was not queued';
  end if;
end;
$$;

rollback;
select 'PASS: admin sign-in alert, deep link and opted-in delivery' as result;
