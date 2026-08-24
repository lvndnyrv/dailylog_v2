-- Cron runs without a signed-in classroom actor, so medication lifecycle
-- notices need a tightly scoped system fan-out rather than the staff-only RPC.

create or replace function public.enqueue_system_medication_notification(
  p_child_id uuid,
  p_title text,
  p_body text,
  p_payload jsonb,
  p_dedupe_key text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid;
  v_count integer;
begin
  select child.daycare_id into v_daycare
    from public.children child
   where child.id = p_child_id;

  if v_daycare is null then
    raise exception 'Medication notification child was not found';
  end if;
  if nullif(btrim(p_title), '') is null
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Medication notification content is invalid';
  end if;

  with recipients as (
    select parent_child.parent_id as profile_id
      from public.parent_children parent_child
     where parent_child.child_id = p_child_id
    union
    select family_member.profile_id
      from public.family_children family_child
      join public.family_members family_member
        on family_member.family_id = family_child.family_id
     where family_child.child_id = p_child_id
       and family_member.receives_messages
  ), queued as (
    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    )
    select v_daycare, recipient.profile_id, 'push', 'medication',
           btrim(p_title), p_body, coalesce(p_payload, '{}'::jsonb), p_dedupe_key
      from recipients recipient
      join public.profiles profile on profile.id = recipient.profile_id
     where profile.archived_at is null
    on conflict do nothing
    returning recipient_id
  ), inbox as (
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    )
    select v_daycare, queued_recipient.recipient_id, 'medication',
           btrim(p_title), p_body, coalesce(p_payload, '{}'::jsonb)
      from (select distinct recipient_id from queued) queued_recipient
    returning id
  )
  select count(*) into v_count from queued;

  return v_count;
end;
$$;

revoke all on function public.enqueue_system_medication_notification(
  uuid, text, text, jsonb, text
) from public;
grant execute on function public.enqueue_system_medication_notification(
  uuid, text, text, jsonb, text
) to service_role;

create or replace function public.process_medication_authorization_statuses()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_record record;
  v_local_today date;
  v_expired_count integer := 0;
  v_reminder_count integer := 0;
  v_has_renewal boolean;
  v_queued integer;
begin
  for auth_record in
    select auth_row.id, auth_row.child_id, auth_row.name,
           auth_row.end_date, daycare.timezone,
           concat_ws(' ', child.first_name, child.last_name) as child_name
      from public.medication_authorizations auth_row
      join public.daycares daycare on daycare.id = auth_row.daycare_id
      join public.children child on child.id = auth_row.child_id
     where auth_row.active
       and auth_row.end_date is not null
  loop
    v_local_today := (now() at time zone coalesce(auth_record.timezone, 'UTC'))::date;
    select exists (
      select 1
        from public.medication_authorizations renewal
       where renewal.renewed_from_id = auth_record.id
         and renewal.active
    ) into v_has_renewal;

    if auth_record.end_date < v_local_today then
      update public.medication_authorizations
         set active = false,
             ended_at = coalesce(ended_at, now()),
             ended_by = null
       where id = auth_record.id
         and active;

      if found then
        v_expired_count := v_expired_count + 1;
        if not v_has_renewal then
          v_queued := public.enqueue_system_medication_notification(
            auth_record.child_id,
            auth_record.name || ' authorization expired',
            'The authorization for ' || auth_record.child_name ||
              ' has ended. Renew it before another dose is needed at care.',
            jsonb_build_object(
              'screen', 'Medication',
              'type', 'medication',
              'childId', auth_record.child_id,
              'authorizationId', auth_record.id,
              'status', 'expired'
            ),
            'medication-authorization-expired:' || auth_record.id
          );
        end if;
      end if;
    elsif auth_record.end_date = v_local_today + 7 and not v_has_renewal then
      v_queued := public.enqueue_system_medication_notification(
        auth_record.child_id,
        auth_record.name || ' expires in 7 days',
        'Review and renew ' || auth_record.child_name ||
          '''s authorization if medication will still be needed at care.',
        jsonb_build_object(
          'screen', 'Medication',
          'type', 'medication',
          'childId', auth_record.child_id,
          'authorizationId', auth_record.id,
          'status', 'expiring'
        ),
        'medication-authorization-expiring:' || auth_record.id
      );
      if v_queued > 0 then
        v_reminder_count := v_reminder_count + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'expired', v_expired_count,
    'renewal_reminders', v_reminder_count,
    'processed_at', now()
  );
end;
$$;
