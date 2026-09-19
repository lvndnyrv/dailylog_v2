-- Parent Mobile Group 19 reporting, editing, cancellation, and isolation tests.
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
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_foreign_child constant uuid := '30000000-0000-4000-a000-000000000002';
  v_today date;
  v_result jsonb;
  v_report uuid;
  v_count integer;
  v_failed boolean;
  v_restricted constant uuid := '00000000-0000-4000-a000-000000000008';
  v_role uuid;
begin
  perform pg_temp.impersonate('postgres');
  insert into public.center_roles (daycare_id, name, base_role, permissions)
  values (
    v_daycare,
    'Rollback-only no attendance visibility',
    'admin',
    '{"attendance":{"view":false,"edit":false,"approve":false}}'
  ) returning id into v_role;
  update public.profiles
     set role = 'admin', center_role_id = v_role, archived_at = null
   where id = v_restricted;
  update public.staff_delegations
     set revoked_at = now()
   where delegate_profile_id = v_restricted and revoked_at is null;
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, current_date), current_date)
   where id = v_child;
  perform pg_temp.impersonate('authenticated', v_parent);
  v_today := public.center_today();

  v_result := public.report_parent_absence(
    v_child, v_today + 40, v_today + 42, 'vacation',
    'Family trip for three days.', null
  );
  v_report := (v_result->>'reportId')::uuid;
  if (v_result->>'days')::integer <> 3 or v_result->>'action' <> 'created' then
    raise exception 'FAIL: parent range result is incomplete: %', v_result;
  end if;

  perform pg_temp.impersonate('postgres');
  select count(*) into v_count from public.attendance_records attendance
   where attendance.absence_report_id = v_report
     and attendance.method = 'parent'
     and attendance.status = 'absent'
     and attendance.absence_reason = 'vacation';
  if v_count <> 3 then raise exception 'FAIL: range did not create three attendance rows'; end if;
  if not exists (
    select 1 from public.audit_log audit
     where audit.entity_id = v_report and audit.action = 'parent_absence_created'
  ) then raise exception 'FAIL: absence creation was not audited'; end if;
  if not exists (
    select 1 from public.notifications notification
     where notification.kind = 'attendance'
       and notification.payload->>'reportId' = v_report::text
       and notification.payload->>'type' = 'attendance_absence'
  ) then raise exception 'FAIL: office and classroom were not notified'; end if;
  if exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_restricted
       and notification.kind = 'attendance'
       and notification.payload ->> 'reportId' = v_report::text
  ) then raise exception 'FAIL: restricted admin received private attendance details'; end if;
  raise notice 'PASS: parent range creates operational attendance, audit, and staff notifications';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_result := public.report_parent_absence(
    v_child, v_today + 41, v_today + 42, 'appointment',
    'Dates changed after the clinic called.', v_report
  );
  if (v_result->>'days')::integer <> 2 or v_result->>'action' <> 'updated' then
    raise exception 'FAIL: parent update result is incomplete: %', v_result;
  end if;
  perform pg_temp.impersonate('postgres');
  select count(*) into v_count from public.attendance_records attendance
   where attendance.absence_report_id = v_report;
  if v_count <> 2 or exists (
    select 1 from public.attendance_records attendance
     where attendance.absence_report_id = v_report and attendance.date = v_today + 40
  ) then raise exception 'FAIL: edit left stale dates behind'; end if;
  raise notice 'PASS: active reports can be edited without stale attendance rows';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_result := public.cancel_parent_absence(v_report);
  if v_result->>'status' <> 'cancelled' or (v_result->>'removedDays')::integer <> 2 then
    raise exception 'FAIL: cancellation result is incomplete: %', v_result;
  end if;
  perform pg_temp.impersonate('postgres');
  if exists (select 1 from public.attendance_records where absence_report_id = v_report)
     or not exists (
       select 1 from public.parent_absence_reports
        where id = v_report and status = 'cancelled'
     ) then raise exception 'FAIL: cancellation was not reflected in the roster'; end if;
  raise notice 'PASS: cancellation releases expected dates and remains in history';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.report_parent_absence(
      v_foreign_child, v_today + 50, v_today + 50, 'sick', null, null
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent reported for an unrelated child'; end if;

  v_failed := false;
  begin
    insert into public.parent_absence_reports (
      daycare_id, child_id, reported_by, starts_on, ends_on, reason
    ) values (
      v_daycare, v_child, v_parent, v_today + 60, v_today + 60, 'other'
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent bypassed the audited RPC'; end if;
  raise notice 'PASS: cross-family and direct-write bypasses are rejected';

  perform pg_temp.impersonate('postgres');
  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, method, status
  ) values (
    v_daycare, v_child, v_today + 55, now(), 'educator', 'present'
  ) on conflict (child_id, date) do update set checked_in_at = now(), status = 'present';
  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.report_parent_absence(
      v_child, v_today + 55, v_today + 55, 'appointment', null, null
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent overwrote a recorded check-in'; end if;
  raise notice 'PASS: recorded attendance cannot be replaced by an absence';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 19 ABSENCE TESTS: ALL PASSED' as result;
