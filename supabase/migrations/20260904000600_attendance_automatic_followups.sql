-- Group 8a/8d: automatically ask families about an unexplained no-show after
-- 9:30 in the center's local timezone, then remind admins one hour later.

create or replace function public.process_due_attendance_followups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_followup_id uuid;
  v_admin_id uuid;
  v_queued integer;
  v_total integer := 0;
  v_message text;
begin
  for v_row in
    select
      child.id as child_id,
      child.daycare_id,
      child.first_name,
      (now() at time zone coalesce(center.timezone, 'UTC'))::date as local_date
    from public.children child
    join public.daycares center on center.id = child.daycare_id
    where child.archived_at is null
      and (now() at time zone coalesce(center.timezone, 'UTC'))::time >= time '09:30'
      and (now() at time zone coalesce(center.timezone, 'UTC'))::time < time '18:00'
      and not exists (
        select 1 from public.center_closures closure
         where closure.daycare_id = child.daycare_id
           and (now() at time zone coalesce(center.timezone, 'UTC'))::date
             between closure.starts_on and closure.ends_on
      )
      and coalesce(
        child.setup_state -> 'weekly_schedule' ->>
          lower(to_char((now() at time zone coalesce(center.timezone, 'UTC'))::date, 'Dy')),
        case
          when extract(isodow from (now() at time zone coalesce(center.timezone, 'UTC'))::date) between 1 and 5
            then 'full'
          else 'off'
        end
      ) in ('full', 'half')
      and not exists (
        select 1 from public.attendance_records attendance
         where attendance.child_id = child.id
           and attendance.date = (now() at time zone coalesce(center.timezone, 'UTC'))::date
           and (
             attendance.checked_in_at is not null
             or attendance.status in ('absent', 'late', 'excused')
           )
      )
      and not exists (
        select 1 from public.attendance_followups followup
         where followup.child_id = child.id
           and followup.attendance_date = (now() at time zone coalesce(center.timezone, 'UTC'))::date
      )
  loop
    select admin.id into v_admin_id
      from public.profiles admin
     where admin.daycare_id = v_row.daycare_id
       and admin.role in ('owner_admin', 'admin')
       and admin.archived_at is null
     order by (admin.role = 'owner_admin') desc, admin.created_at
     limit 1;
    if v_admin_id is null then continue; end if;

    v_message := 'Hi — just checking in. We were expecting ' || v_row.first_name ||
      ' this morning. All good? No need to call; you can report an absence in the DailyLog app.';

    insert into public.attendance_followups (
      daycare_id, child_id, attendance_date, message, sent_by, escalation_due_at
    ) values (
      v_row.daycare_id, v_row.child_id, v_row.local_date, v_message,
      v_admin_id, now() + interval '1 hour'
    ) returning id into v_followup_id;

    with recipients as (
      select guardian.id, guardian.email
        from public.parent_children link
        join public.profiles guardian on guardian.id = link.parent_id
       where link.child_id = v_row.child_id and guardian.archived_at is null
      union
      select guardian.id, guardian.email
        from public.family_children family_child
        join public.family_members member on member.family_id = family_child.family_id
        join public.profiles guardian on guardian.id = member.profile_id
       where family_child.child_id = v_row.child_id
         and member.receives_messages and guardian.archived_at is null
    ), queued as (
      insert into public.notification_outbox (
        daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
      )
      select v_row.daycare_id, recipient.id, channel, 'attendance_followup',
             'Is ' || v_row.first_name || ' coming today?', v_message,
             jsonb_build_object(
               'type', 'attendance_followup', 'screen', 'ReportAbsence',
               'childId', v_row.child_id, 'date', v_row.local_date,
               'followupId', v_followup_id
             ),
             'attendance-followup:' || v_followup_id || ':' || channel
        from recipients recipient
        cross join unnest(array['push', 'email']::text[]) channel
      on conflict do nothing
      returning recipient_id
    )
    select count(*)::integer into v_queued from queued;

    insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
    select v_row.daycare_id, recipient.id, 'attendance_followup',
           'Is ' || v_row.first_name || ' coming today?', v_message,
           jsonb_build_object(
             'type', 'attendance_followup', 'screen', 'ReportAbsence',
             'childId', v_row.child_id, 'date', v_row.local_date,
             'followupId', v_followup_id
           )
      from (
        select guardian.id
          from public.parent_children link
          join public.profiles guardian on guardian.id = link.parent_id
         where link.child_id = v_row.child_id and guardian.archived_at is null
        union
        select guardian.id
          from public.family_children family_child
          join public.family_members member on member.family_id = family_child.family_id
          join public.profiles guardian on guardian.id = member.profile_id
         where family_child.child_id = v_row.child_id
           and member.receives_messages and guardian.archived_at is null
      ) recipient;

    update public.attendance_followups
       set queued_recipients = coalesce(v_queued, 0)
     where id = v_followup_id;

    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload,
      dedupe_key, available_at
    ) values (
      v_row.daycare_id, v_admin_id, 'push', 'attendance_escalation',
      'No attendance reply for ' || v_row.first_name,
      'Use the child''s emergency contacts if the family still has not replied.',
      jsonb_build_object(
        'type', 'attendance_escalation', 'screen', 'Attendance',
        'childId', v_row.child_id, 'date', v_row.local_date,
        'followupId', v_followup_id
      ),
      'attendance-escalation:' || v_followup_id || ':' || v_admin_id,
      now() + interval '1 hour'
    ) on conflict do nothing;

    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.process_due_attendance_followups() from public, anon, authenticated;
grant execute on function public.process_due_attendance_followups() to service_role;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'dailylog-attendance-followups';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'dailylog-attendance-followups',
    '*/5 * * * *',
    'select public.process_due_attendance_followups();'
  );
end;
$$;

notify pgrst, 'reload schema';
