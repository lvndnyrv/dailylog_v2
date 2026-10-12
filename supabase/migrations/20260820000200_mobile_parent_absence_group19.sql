-- Parent Mobile Group 19 — parent-reported absences with range management.

create table if not exists public.parent_absence_reports (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  reported_by uuid not null references public.profiles(id) on delete restrict,
  starts_on date not null,
  ends_on date not null,
  reason text not null check (reason in ('sick', 'appointment', 'vacation', 'other')),
  note text,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (length(coalesce(note, '')) <= 500)
);

create index if not exists parent_absence_reports_child_dates_idx
  on public.parent_absence_reports (child_id, starts_on desc, ends_on desc);
create index if not exists parent_absence_reports_center_active_idx
  on public.parent_absence_reports (daycare_id, starts_on, ends_on)
  where status = 'active';

drop trigger if exists parent_absence_reports_updated_at
  on public.parent_absence_reports;
create trigger parent_absence_reports_updated_at
  before update on public.parent_absence_reports
  for each row execute function public.update_updated_at();

alter table public.parent_absence_reports enable row level security;

drop policy if exists "families read linked absence reports"
  on public.parent_absence_reports;
create policy "families read linked absence reports"
  on public.parent_absence_reports for select
  using (child_id in (select public.my_child_ids()));

drop policy if exists "staff read center absence reports"
  on public.parent_absence_reports;
create policy "staff read center absence reports"
  on public.parent_absence_reports for select
  using (
    public.is_staff()
    and daycare_id = public.get_my_daycare_id()
    and public.has_permission('attendance', 'view')
  );

alter table public.attendance_records
  add column if not exists absence_report_id uuid
    references public.parent_absence_reports(id) on delete set null,
  add column if not exists absence_reported_by uuid
    references public.profiles(id) on delete set null,
  add column if not exists absence_reported_at timestamptz;

create index if not exists attendance_records_absence_report_idx
  on public.attendance_records (absence_report_id)
  where absence_report_id is not null;

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

  -- The central outbox trigger validates this transaction-local marker against
  -- the report, recipient and signed-in parent before allowing the enqueue.
  perform set_config('dailylog.parent_absence_report_id', p_report.id::text, true);

  with recipients as (
    select profile.id
      from public.profiles profile
     where profile.daycare_id = p_report.daycare_id
       and profile.archived_at is null
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
         v_title, v_body,
         jsonb_build_object(
           'type', v_type,
           'screen', 'Attendance',
           'childId', p_report.child_id,
           'reportId', p_report.id,
           'startsOn', p_report.starts_on,
           'endsOn', p_report.ends_on,
           'href', '/attendance?date=' || p_report.starts_on,
           'eventKey', v_event_key
         ),
         v_event_key
    from recipients recipient
  on conflict do nothing;

  with recipients as (
    select profile.id
      from public.profiles profile
     where profile.daycare_id = p_report.daycare_id
       and profile.archived_at is null
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
  select p_report.daycare_id, recipient.id, 'attendance', v_title, v_body,
         jsonb_build_object(
           'type', v_type,
           'screen', 'Attendance',
           'childId', p_report.child_id,
           'reportId', p_report.id,
           'startsOn', p_report.starts_on,
           'endsOn', p_report.ends_on,
           'href', '/attendance?date=' || p_report.starts_on,
           'eventKey', v_event_key
         )
    from recipients recipient
   where not exists (
     select 1 from public.notifications notification
      where notification.profile_id = recipient.id
        and notification.payload->>'eventKey' = v_event_key
   );
end;
$$;

revoke all on function public._notify_parent_absence(
  public.parent_absence_reports, text
) from public, anon, authenticated;

create or replace function public.get_parent_absence_hub(p_child_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_today date := public.center_today();
  v_child public.children%rowtype;
  v_daycare public.daycares%rowtype;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent'
     or p_child_id not in (select public.my_child_ids()) then
    raise exception 'This child is not linked to your family';
  end if;

  select * into v_child
    from public.children child
   where child.id = p_child_id and child.archived_at is null;
  if v_child.id is null then raise exception 'This child is unavailable'; end if;
  select * into v_daycare from public.daycares where id = v_child.daycare_id;

  return jsonb_build_object(
    'today', v_today,
    'daycare', jsonb_build_object('id', v_daycare.id, 'name', v_daycare.name),
    'child', jsonb_build_object(
      'id', v_child.id,
      'first_name', v_child.first_name,
      'last_name', v_child.last_name,
      'classroom_id', v_child.classroom_id,
      'classroom_name', (
        select classroom.name from public.classrooms classroom
         where classroom.id = v_child.classroom_id
      ),
      'educators', coalesce((
        select jsonb_agg(distinct profile.full_name order by profile.full_name)
          from public.profiles profile
         where profile.role = 'educator'
           and profile.archived_at is null
           and (
             profile.classroom_id = v_child.classroom_id
             or exists (
               select 1 from public.educator_classrooms assignment
                where assignment.educator_id = profile.id
                  and assignment.classroom_id = v_child.classroom_id
             )
           )
      ), '[]'::jsonb)
    ),
    'reports', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', report.id,
          'starts_on', report.starts_on,
          'ends_on', report.ends_on,
          'reason', report.reason,
          'note', report.note,
          'status', report.status,
          'reported_by', report.reported_by,
          'reported_by_name', reporter.full_name,
          'created_at', report.created_at,
          'updated_at', report.updated_at,
          'cancelled_at', report.cancelled_at,
          'editable', report.status = 'active' and report.ends_on >= v_today,
          'attendance_dates', coalesce((
            select jsonb_agg(attendance.date order by attendance.date)
              from public.attendance_records attendance
             where attendance.absence_report_id = report.id
          ), '[]'::jsonb)
        ) order by
          (report.status = 'active' and report.ends_on >= v_today) desc,
          report.starts_on desc
      )
        from public.parent_absence_reports report
        join public.profiles reporter on reporter.id = report.reported_by
       where report.child_id = v_child.id
         and report.ends_on >= v_today - 90
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.report_parent_absence(
  p_child_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_reason text,
  p_note text default null,
  p_report_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.center_today();
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_child public.children%rowtype;
  v_report public.parent_absence_reports%rowtype;
  v_before jsonb;
  v_action text := 'created';
  v_count integer;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent'
     or p_child_id not in (select public.my_child_ids()) then
    raise exception 'This child is not linked to your family';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'Choose the absence date';
  end if;
  if p_starts_on < v_today then raise exception 'Past absences cannot be reported'; end if;
  if p_ends_on < p_starts_on then raise exception 'The end date must follow the start date'; end if;
  if p_ends_on > p_starts_on + 30 then raise exception 'An absence range can be at most 31 days'; end if;
  if v_reason not in ('sick', 'appointment', 'vacation', 'other') then
    raise exception 'Choose an absence reason';
  end if;
  if length(coalesce(v_note, '')) > 500 then raise exception 'Note is too long'; end if;
  perform public.assert_rate_limit('report_parent_absence', 20, 600, p_child_id::text);

  select * into v_child from public.children child
   where child.id = p_child_id and child.archived_at is null;
  if v_child.id is null then raise exception 'This child is unavailable'; end if;

  if p_report_id is not null then
    select * into v_report
      from public.parent_absence_reports report
     where report.id = p_report_id
       and report.child_id = p_child_id
       and report.status = 'active'
     for update;
    if v_report.id is null then raise exception 'This absence can no longer be edited'; end if;
    if v_report.ends_on < v_today then raise exception 'Completed absences cannot be edited'; end if;
    v_before := to_jsonb(v_report);
    v_action := 'updated';

    delete from public.attendance_records attendance
     where attendance.absence_report_id = v_report.id
       and attendance.date >= v_today
       and attendance.checked_in_at is null
       and attendance.checked_out_at is null;
  end if;

  if exists (
    select 1 from public.attendance_records attendance
     where attendance.child_id = p_child_id
       and attendance.date between p_starts_on and p_ends_on
       and (attendance.checked_in_at is not null or attendance.checked_out_at is not null)
  ) then
    raise exception 'Attendance is already recorded for one of these dates';
  end if;
  if exists (
    select 1 from public.attendance_records attendance
     where attendance.child_id = p_child_id
       and attendance.date between p_starts_on and p_ends_on
       and attendance.absence_report_id is not null
       and attendance.absence_report_id is distinct from p_report_id
  ) then
    raise exception 'An absence is already reported for one of these dates';
  end if;

  if p_report_id is null then
    insert into public.parent_absence_reports (
      daycare_id, child_id, reported_by, starts_on, ends_on, reason, note
    ) values (
      v_child.daycare_id, p_child_id, auth.uid(),
      p_starts_on, p_ends_on, v_reason, v_note
    ) returning * into v_report;
  else
    update public.parent_absence_reports
       set starts_on = p_starts_on,
           ends_on = p_ends_on,
           reason = v_reason,
           note = v_note,
           cancelled_at = null,
           cancelled_by = null
     where id = p_report_id
     returning * into v_report;
  end if;

  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, checked_in_by,
    checked_out_at, checked_out_by, method, status, absence_reason, notes,
    absence_report_id, absence_reported_by, absence_reported_at
  )
  select v_child.daycare_id, p_child_id, day::date, null, null,
         null, null, 'parent', 'absent', v_reason, v_note,
         v_report.id, auth.uid(), now()
    from generate_series(p_starts_on, p_ends_on, interval '1 day') day
  on conflict (child_id, date) do update set
    checked_in_at = null,
    checked_in_by = null,
    checked_out_at = null,
    checked_out_by = null,
    method = 'parent',
    status = 'absent',
    absence_reason = excluded.absence_reason,
    notes = excluded.notes,
    absence_report_id = excluded.absence_report_id,
    absence_reported_by = excluded.absence_reported_by,
    absence_reported_at = excluded.absence_reported_at,
    updated_at = now();
  get diagnostics v_count = row_count;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_child.daycare_id, auth.uid(), 'parent_absence_' || v_action,
    'parent_absence_report', v_report.id, v_before, to_jsonb(v_report)
  );
  perform public._notify_parent_absence(v_report, v_action);

  return jsonb_build_object(
    'reportId', v_report.id,
    'childId', v_report.child_id,
    'startsOn', v_report.starts_on,
    'endsOn', v_report.ends_on,
    'reason', v_report.reason,
    'note', v_report.note,
    'days', v_count,
    'action', v_action,
    'notifiedCenter', true
  );
end;
$$;

create or replace function public.cancel_parent_absence(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.center_today();
  v_report public.parent_absence_reports%rowtype;
  v_before jsonb;
  v_removed integer;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent' then
    raise exception 'A parent account is required';
  end if;
  select * into v_report
    from public.parent_absence_reports report
   where report.id = p_report_id and report.status = 'active'
   for update;
  if v_report.id is null then raise exception 'This absence is no longer active'; end if;
  if v_report.child_id not in (select public.my_child_ids()) then
    raise exception 'This absence does not belong to your family';
  end if;
  if v_report.ends_on < v_today then raise exception 'Completed absences cannot be cancelled'; end if;
  perform public.assert_rate_limit('cancel_parent_absence', 20, 600, v_report.child_id::text);

  v_before := to_jsonb(v_report);
  delete from public.attendance_records attendance
   where attendance.absence_report_id = v_report.id
     and attendance.date >= v_today
     and attendance.checked_in_at is null
     and attendance.checked_out_at is null;
  get diagnostics v_removed = row_count;

  update public.parent_absence_reports
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
   where id = v_report.id
   returning * into v_report;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_report.daycare_id, auth.uid(), 'parent_absence_cancelled',
    'parent_absence_report', v_report.id, v_before, to_jsonb(v_report)
  );
  perform public._notify_parent_absence(v_report, 'cancelled');

  return jsonb_build_object(
    'reportId', v_report.id,
    'childId', v_report.child_id,
    'status', 'cancelled',
    'removedDays', v_removed,
    'notifiedCenter', true
  );
end;
$$;

revoke all on table public.parent_absence_reports from anon, authenticated;
grant select on table public.parent_absence_reports to authenticated;
revoke all on function public.get_parent_absence_hub(uuid) from public, anon;
revoke all on function public.report_parent_absence(uuid, date, date, text, text, uuid)
  from public, anon;
revoke all on function public.cancel_parent_absence(uuid) from public, anon;
grant execute on function public.get_parent_absence_hub(uuid) to authenticated;
grant execute on function public.report_parent_absence(uuid, date, date, text, text, uuid)
  to authenticated;
grant execute on function public.cancel_parent_absence(uuid) to authenticated;
