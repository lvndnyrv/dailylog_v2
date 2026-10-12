-- Parent absence alerts contain child attendance information. Route them only
-- to active staff who can view attendance, while retaining classroom scoping
-- for educators.

create or replace function public._notify_parent_absence(
  p_report public.parent_absence_reports,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child public.children%rowtype;
  v_reason_label text := initcap(replace(p_report.reason, '_', ' '));
  v_title text;
  v_body text;
  v_event_key text;
  v_type text;
  v_payload jsonb;
begin
  if p_action not in ('created', 'updated', 'cancelled') then
    raise exception 'Unsupported absence notification action';
  end if;

  select * into v_child from public.children where id = p_report.child_id;
  v_type := case when p_action = 'cancelled'
    then 'attendance_absence_cancelled' else 'attendance_absence' end;
  v_title := case p_action
    when 'created' then v_child.first_name || ' will be absent'
    when 'updated' then v_child.first_name || '''s absence was updated'
    else v_child.first_name || '''s absence was cancelled'
  end;
  v_body := case when p_action = 'cancelled' then
    to_char(p_report.starts_on, 'Mon FMDD') || case
      when p_report.ends_on = p_report.starts_on then ''
      else '–' || to_char(p_report.ends_on, 'Mon FMDD') end
  else
    v_reason_label || ' · ' || to_char(p_report.starts_on, 'Mon FMDD') || case
      when p_report.ends_on = p_report.starts_on then ''
      else '–' || to_char(p_report.ends_on, 'Mon FMDD') end
      || coalesce(' · ' || p_report.note, '')
  end;
  v_event_key := 'parent-absence:' || p_report.id || ':' || p_action || ':'
    || extract(epoch from p_report.updated_at)::text;
  v_payload := jsonb_build_object(
    'type', v_type,
    'screen', 'Attendance',
    'childId', p_report.child_id,
    'reportId', p_report.id,
    'startsOn', p_report.starts_on,
    'endsOn', p_report.ends_on,
    'href', '/attendance?date=' || p_report.starts_on,
    'eventKey', v_event_key
  );

  perform set_config('dailylog.parent_absence_report_id', p_report.id::text, true);

  with recipients as (
    select profile.id
      from public.profiles profile
     where profile.daycare_id = p_report.daycare_id
       and public.profile_has_permission(profile.id, 'attendance', 'view')
       and (
         profile.role in ('owner_admin', 'admin')
         or (
           profile.role = 'educator'
           and (
             profile.classroom_id = v_child.classroom_id
             or exists (
               select 1 from public.educator_classrooms assignment
                where assignment.educator_id = profile.id
                  and assignment.classroom_id = v_child.classroom_id
             )
           )
         )
       )
  )
  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  )
  select p_report.daycare_id, recipient.id, 'push', 'attendance',
         v_title, v_body, v_payload, v_event_key
    from recipients recipient
  on conflict do nothing;

  with recipients as (
    select profile.id
      from public.profiles profile
     where profile.daycare_id = p_report.daycare_id
       and public.profile_has_permission(profile.id, 'attendance', 'view')
       and (
         profile.role in ('owner_admin', 'admin')
         or (
           profile.role = 'educator'
           and (
             profile.classroom_id = v_child.classroom_id
             or exists (
               select 1 from public.educator_classrooms assignment
                where assignment.educator_id = profile.id
                  and assignment.classroom_id = v_child.classroom_id
             )
           )
         )
       )
  )
  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  )
  select p_report.daycare_id, recipient.id, 'attendance', v_title, v_body, v_payload
    from recipients recipient
   where not exists (
     select 1 from public.notifications notification
      where notification.profile_id = recipient.id
        and notification.payload ->> 'eventKey' = v_event_key
   );
end;
$$;

comment on function public._notify_parent_absence(public.parent_absence_reports, text) is
  'Routes parent absence changes to effective attendance viewers, classroom-scoped for educators.';

notify pgrst, 'reload schema';
