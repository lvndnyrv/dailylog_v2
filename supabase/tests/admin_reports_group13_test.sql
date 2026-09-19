-- Rollback-safe Group 13 schedule, export-audit and tenant-isolation checks.
begin;
create or replace function pg_temp.impersonate(p_role text,p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_user,'role',case when p_role='postgres' then 'service_role' else p_role end)::text,true);
  perform set_config('role',p_role,true);
end $$;
create function pg_temp.expect_denied(p_sql text)
returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FAIL: operation unexpectedly allowed: %',p_sql;
end $$;
do $$
declare
  v_owner uuid:='00000000-0000-4000-a000-000000000001';
  v_parent uuid;v_daycare uuid;v_other uuid;v_schedule uuid;v_export uuid;v_other_export uuid;
begin
  select daycare_id into v_daycare from public.profiles where id=v_owner;
  if v_daycare is null then raise exception 'Missing dev owner fixture'; end if;
  select id into v_parent from public.profiles where daycare_id=v_daycare and role='parent' limit 1;
  if v_parent is null then raise exception 'Missing dev parent fixture'; end if;
  perform pg_temp.impersonate('postgres');
  insert into public.daycares(name) values('Rollback-only report isolation center') returning id into v_other;
  insert into public.report_exports(daycare_id,report_kind,title,format)
    values(v_other,'attendance','Private other-center export','pdf') returning id into v_other_export;

  perform pg_temp.impersonate('authenticated',v_owner);
  if exists(select 1 from public.report_exports where id=v_other_export) then
    raise exception 'FAIL: cross-center export visible';
  end if;
  insert into public.report_schedules(daycare_id,created_by,report_kind,cadence,delivery_day,delivery_time,recipient_ids,formats)
    values(v_daycare,v_owner,'incidents','weekly',1,'07:00',array[v_owner],array['pdf','csv'])
    returning id into v_schedule;
  if (select next_run_at from public.report_schedules where id=v_schedule) is null then
    raise exception 'FAIL: active schedule has no next run';
  end if;
  perform pg_temp.expect_denied(format(
    'update public.report_schedules set recipient_ids=array[%L::uuid] where id=%L',v_parent,v_schedule));
  update public.report_schedules set active=false where id=v_schedule;
  if (select next_run_at from public.report_schedules where id=v_schedule) is not null then
    raise exception 'FAIL: paused schedule retains a next run';
  end if;
  insert into public.report_exports(daycare_id,created_by,report_kind,title,starts_on,ends_on,format,row_count)
    values(v_daycare,v_owner,'incidents','Incident log',current_date-7,current_date,'csv',4)
    returning id into v_export;
  if not exists(select 1 from public.audit_log where entity_id=v_export and action='report.exported') then
    raise exception 'FAIL: export audit entry missing';
  end if;
  if not exists(select 1 from public.audit_log where entity_id=v_schedule and action='report_schedule.updated') then
    raise exception 'FAIL: schedule update audit entry missing';
  end if;

  perform pg_temp.impersonate('postgres');
  update public.report_schedules set active=true where id=v_schedule;
  update public.report_schedules set next_run_at=now()-interval '1 minute' where id=v_schedule;
  perform public.process_due_report_schedules();
  if (select last_run_at from public.report_schedules where id=v_schedule) is null
     or (select next_run_at from public.report_schedules where id=v_schedule)<=now() then
    raise exception 'FAIL: due schedule did not advance';
  end if;
  if not exists(
    select 1 from public.notification_outbox
      where dedupe_key like 'report-schedule:'||v_schedule::text||':%'
        and recipient_id=v_owner and channel='email'
  ) then raise exception 'FAIL: scheduled report email was not queued'; end if;
  if not exists(
    select 1 from public.report_exports
      where parameters->>'schedule_id'=v_schedule::text
  ) then raise exception 'FAIL: scheduled export history was not materialized'; end if;

  perform pg_temp.impersonate('authenticated',v_parent);
  if exists(select 1 from public.report_exports where id=v_export) then
    raise exception 'FAIL: parent can read report export history';
  end if;
  perform pg_temp.expect_denied(format(
    'insert into public.report_exports(daycare_id,created_by,report_kind,title,format) values(%L,%L,''attendance'',''Forbidden'',''csv'')',v_daycare,v_parent));
end $$;
rollback;
select 'PASS: Group 13 schedules compute and advance next runs, validate recipients, queue deliveries, audit exports, and enforce role/tenant boundaries' as result;
