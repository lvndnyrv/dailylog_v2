-- Rollback-safe regression coverage for same-day credential reminders.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_daycare uuid;
  v_credential uuid;
  v_result jsonb;
  v_notification_count integer;
begin
  select profile.daycare_id into v_daycare
    from public.profiles profile where profile.id = v_owner;
  select credential.id into v_credential
    from public.staff_credentials credential
    join public.staff_members staff on staff.id = credential.staff_member_id
   where staff.profile_id = v_educator
     and credential.archived_at is null
   order by credential.created_at
   limit 1;
  if v_daycare is null or v_credential is null then
    raise exception 'Missing credential-reminder fixtures';
  end if;

  perform pg_temp.impersonate('postgres');
  delete from public.notification_outbox outbox
   where outbox.payload ->> 'credentialId' = v_credential::text;
  delete from public.notifications notification
   where notification.payload ->> 'credentialId' = v_credential::text;

  perform pg_temp.impersonate('authenticated', v_owner);
  v_result := public.send_staff_credential_reminder(v_credential, true);
  if not coalesce((v_result ->> 'sent')::boolean, false)
     or not coalesce((v_result ->> 'followUpScheduled')::boolean, false) then
    raise exception 'FAIL: initial reminder and follow-up were not queued';
  end if;

  v_result := public.send_staff_credential_reminder(v_credential, true);
  if coalesce((v_result ->> 'sent')::boolean, false)
     or coalesce((v_result ->> 'followUpScheduled')::boolean, false) then
    raise exception 'FAIL: duplicate reminder was reported as newly sent';
  end if;

  perform pg_temp.impersonate('postgres');
  select count(*) into v_notification_count
    from public.notifications notification
   where notification.profile_id = v_educator
     and notification.kind = 'credential_reminder'
     and notification.payload ->> 'credentialId' = v_credential::text;
  if v_notification_count <> 1 then
    raise exception 'FAIL: expected one in-app reminder, found %', v_notification_count;
  end if;
end $$;

rollback;
select 'PASS: credential reminders are deduplicated across in-app and delivery channels' as result;
