-- Make administrator waitlist check-ins an all-or-nothing batch and activate
-- the overdue processor that was previously defined but never scheduled.

create or replace function public.send_waitlist_checkins(
  p_enrollment_ids uuid[],
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_ids uuid[];
  v_family public.enrollments%rowtype;
  v_attempt integer;
  v_sent integer := 0;
  v_message text := btrim(coalesce(p_message, ''));
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit') then
    raise exception 'Administrator enrollment-edit permission required';
  end if;

  select array_agg(distinct requested.id order by requested.id)
    into v_ids
    from unnest(coalesce(p_enrollment_ids, '{}'::uuid[])) requested(id)
   where requested.id is not null;
  if coalesce(cardinality(v_ids), 0) < 1 then
    raise exception 'Select at least one active waitlist family';
  end if;
  if cardinality(v_ids) > 50 then
    raise exception 'Send at most 50 waitlist check-ins at a time';
  end if;
  if v_message = '' then
    raise exception 'Enter a check-in message';
  end if;
  if length(v_message) > 2000 then
    raise exception 'Check-in message is too long';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));

  for v_family in
    select enrollment.*
      from public.enrollments enrollment
     where enrollment.id = any(v_ids)
       and enrollment.daycare_id = v_center_id
     order by enrollment.id
     for update
  loop
    if v_family.waitlist_status <> 'active' then
      raise exception '% is no longer on the active waitlist',
        coalesce(v_family.guardian_name, 'A selected family');
    end if;
    if v_family.waitlist_response_due_at is not null
       and v_family.waitlist_response_due_at > now() then
      raise exception '% already has a response window open until %',
        coalesce(v_family.guardian_name, 'A selected family'),
        to_char(v_family.waitlist_response_due_at at time zone 'UTC', 'Mon FMDD, YYYY');
    end if;
    if v_family.guardian_email is null
       or v_family.guardian_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       or v_family.offer_code is null then
      raise exception '% needs a valid guardian email and secure family link',
        coalesce(v_family.guardian_name, 'A selected family');
    end if;

    v_attempt := v_family.waitlist_unanswered_checkins + 1;
    update public.enrollments
       set waitlist_last_contact_at = now(),
           waitlist_unanswered_checkins = v_attempt,
           waitlist_response_due_at = now() + interval '7 days'
     where id = v_family.id;

    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_center_id,
      lower(v_family.guardian_email),
      'email',
      'waitlist_checkin',
      'Still interested in Sunny Grove?',
      v_message
        || E'\n\nPlease respond within 7 days in DailyLog: dailylog://inquiry?code='
        || upper(v_family.offer_code),
      jsonb_build_object(
        'type', 'waitlist_checkin',
        'screen', 'ParentInquiryJourney',
        'journeyCode', upper(v_family.offer_code),
        'enrollmentId', v_family.id,
        'attempt', v_attempt,
        'respondBy', now() + interval '7 days'
      ),
      'waitlist-checkin:' || v_family.id || ':' || v_attempt
    );
    v_sent := v_sent + 1;
  end loop;

  if v_sent <> cardinality(v_ids) then
    raise exception 'One or more selected waitlist families are unavailable';
  end if;

  return jsonb_build_object(
    'status', 'sent',
    'sent_count', v_sent,
    'respond_by', now() + interval '7 days'
  );
end;
$$;

revoke all on function public.send_waitlist_checkins(uuid[], text)
  from public, anon;
grant execute on function public.send_waitlist_checkins(uuid[], text)
  to authenticated;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job
   where jobname = 'dailylog-overdue-waitlist-checkins';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'dailylog-overdue-waitlist-checkins',
    '20 * * * *',
    'select public.process_overdue_waitlist_checkins();'
  );
end;
$$;

notify pgrst, 'reload schema';
