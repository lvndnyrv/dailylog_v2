-- Group 8: one expected-day resolver for the admin list and the 9:30
-- no-show worker. Dated bookings override recurring patterns, which override
-- the legacy weekly schedule. A child is never chased before their first day
-- or after a scheduled departure.
create or replace function public._attendance_expected_children(
  p_center uuid, p_date date
)
returns table(child_id uuid, chase_after time)
language sql stable security definer set search_path = public as $$
  select child.id,
    case
      when booking.child_id is not null then
        greatest(time '09:30', (booking.arrives_at + interval '10 minutes')::time)
      when pattern.child_id is not null then
        greatest(time '09:30', (pattern.arrives_at + interval '10 minutes')::time)
      else time '09:30'
    end
  from public.children child
  left join public.child_attendance_bookings booking
    on booking.child_id = child.id and booking.booked_on = p_date
  left join public.child_attendance_booking_patterns pattern
    on pattern.child_id = child.id
   and pattern.starts_on <= p_date
   and (pattern.ends_on is null or pattern.ends_on >= p_date)
  where child.daycare_id = p_center
    and child.archived_at is null
    and coalesce(child.enrolled_on, '-infinity'::date) <= p_date
    and not exists (
      select 1 from public.child_departures departure
       where departure.child_id = child.id
         and departure.status in ('scheduled', 'completed')
         and departure.last_day < p_date
    )
    and not exists (
      select 1 from public.parent_absence_reports absence
       where absence.child_id = child.id
         and absence.status = 'active'
         and p_date between absence.starts_on and absence.ends_on
    )
    and case
      when booking.child_id is not null then booking.expected
      when pattern.child_id is not null then
        extract(isodow from p_date)::smallint = any(pattern.weekdays)
      else coalesce(
        child.setup_state -> 'weekly_schedule' ->>
          (array['sun','mon','tue','wed','thu','fri','sat'])[
            extract(dow from p_date)::integer + 1
          ],
        case when extract(isodow from p_date) between 1 and 5
          then 'full' else 'off' end
      ) in ('full', 'half')
    end;
$$;

revoke all on function public._attendance_expected_children(uuid,date)
  from public, anon, authenticated;

create or replace function public.get_attendance_expected_children(p_date date)
returns table(child_id uuid, chase_after time)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin()
     or not public.has_permission('attendance', 'view') then
    raise exception 'Attendance viewing permission required';
  end if;
  if p_date is null then raise exception 'Attendance date required'; end if;
  return query
    select expected.child_id, expected.chase_after
      from public._attendance_expected_children(public.get_my_daycare_id(), p_date) expected;
end;
$$;

revoke all on function public.get_attendance_expected_children(date)
  from public, anon;
grant execute on function public.get_attendance_expected_children(date)
  to authenticated;

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
    select child.id as child_id, child.daycare_id, child.first_name,
      local_day.local_date
    from public.daycares center
    cross join lateral (
      select (now() at time zone coalesce(center.timezone, 'UTC'))::date as local_date,
        (now() at time zone coalesce(center.timezone, 'UTC'))::time as local_time
    ) local_day
    cross join lateral public._attendance_expected_children(
      center.id, local_day.local_date
    ) expected
    join public.children child on child.id = expected.child_id
    where local_day.local_time >= expected.chase_after
      and local_day.local_time < time '18:00'
      and not exists (
        select 1 from public.center_closures closure
         where closure.daycare_id = center.id
           and local_day.local_date between closure.starts_on and closure.ends_on
      )
      and not exists (
        select 1 from public.attendance_records attendance
         where attendance.child_id = child.id
           and attendance.date = local_day.local_date
           and (
             attendance.checked_in_at is not null
             or attendance.status in ('absent', 'late', 'excused')
           )
      )
      and not exists (
        select 1 from public.attendance_followups followup
         where followup.child_id = child.id
           and followup.attendance_date = local_day.local_date
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

revoke all on function public.process_due_attendance_followups()
  from public, anon, authenticated;
grant execute on function public.process_due_attendance_followups()
  to service_role;

notify pgrst, 'reload schema';
