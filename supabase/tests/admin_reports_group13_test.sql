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
  v_parent uuid;v_daycare uuid;v_other uuid;v_schedule uuid;v_export uuid;v_pdf uuid;v_other_export uuid;
  v_scheduled_pdf uuid;v_duplicate_pdf uuid;
  v_start date;v_end date;v_run_on date;
begin
  select starts_on,ends_on into v_start,v_end
    from public.report_schedule_period('weekly',1,'2026-10-19');
  if (v_start,v_end) is distinct from ('2026-10-12'::date,'2026-10-18'::date) then
    raise exception 'FAIL: weekly report period is not a full week';
  end if;
  select starts_on,ends_on into v_start,v_end
    from public.report_schedule_period('monthly',1,'2026-10-01');
  if (v_start,v_end) is distinct from ('2026-09-01'::date,'2026-09-30'::date) then
    raise exception 'FAIL: first-of-month report missed the previous calendar month';
  end if;
  select starts_on,ends_on into v_start,v_end
    from public.report_schedule_period('monthly',15,'2026-10-15');
  if (v_start,v_end) is distinct from ('2026-09-15'::date,'2026-10-14'::date) then
    raise exception 'FAIL: mid-month report left a gap';
  end if;
  select starts_on,ends_on into v_start,v_end
    from public.report_schedule_period('monthly',31,'2026-03-31');
  if (v_start,v_end) is distinct from ('2026-02-28'::date,'2026-03-30'::date) then
    raise exception 'FAIL: short previous month was not clamped';
  end if;
  select starts_on,ends_on into v_start,v_end
    from public.report_schedule_period('monthly',31,'2026-04-30');
  if (v_start,v_end) is distinct from ('2026-03-31'::date,'2026-04-29'::date) then
    raise exception 'FAIL: consecutive month-end report periods overlap or leave a gap';
  end if;
  select starts_on,ends_on into v_start,v_end
    from public.report_schedule_period('monthly',31,'2024-03-31');
  if (v_start,v_end) is distinct from ('2024-02-29'::date,'2024-03-30'::date) then
    raise exception 'FAIL: leap-year February was not clamped correctly';
  end if;
  select starts_on,ends_on into v_start,v_end
    from public.report_schedule_period('quarterly',15,'2027-01-15');
  if (v_start,v_end) is distinct from ('2026-10-15'::date,'2027-01-14'::date) then
    raise exception 'FAIL: rolling quarter was incomplete';
  end if;
  select starts_on,ends_on into v_start,v_end
    from public.report_schedule_period('quarterly',1,'2027-01-01');
  if (v_start,v_end) is distinct from ('2026-10-01'::date,'2026-12-31'::date) then
    raise exception 'FAIL: calendar quarter was incomplete';
  end if;
  select starts_on,ends_on into v_start,v_end
    from public.report_schedule_period('quarterly',15,'2027-04-15');
  if (v_start,v_end) is distinct from ('2027-01-15'::date,'2027-04-14'::date) then
    raise exception 'FAIL: consecutive quarterly periods overlap or leave a gap';
  end if;
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
  if (select storage_path from public.report_exports where id=v_export) is not null then
    raise exception 'FAIL: historical metadata-only export unexpectedly has a saved file';
  end if;
  if (select expires_at < generated_at + interval '7 years'
      from public.report_exports where id=v_export) then
    raise exception 'FAIL: export retention is shorter than seven years';
  end if;
  perform pg_temp.expect_denied(format(
    'insert into public.report_exports(daycare_id,created_by,report_kind,title,format,generated_at,expires_at) values(%L,%L,''incidents'',''Short retention'',''csv'',now(),now()+interval ''1 year'')',
    v_daycare,v_owner));
  update public.report_exports set title='Changed' where id=v_export;
  if (select title from public.report_exports where id=v_export)<>'Incident log' then
    raise exception 'FAIL: admin changed an immutable export';
  end if;
  delete from public.report_exports where id=v_export;
  if not exists(select 1 from public.report_exports where id=v_export) then
    raise exception 'FAIL: admin deleted an immutable export';
  end if;
  perform pg_temp.expect_denied('select * from public.report_archive_retention_health()');
  perform pg_temp.expect_denied(format(
    'insert into public.report_exports(id,daycare_id,created_by,report_kind,title,format,storage_path,content_sha256,content_bytes) values(%L,%L,%L,''incidents'',''Bad archive'',''csv'',%L,%L,3)',
    gen_random_uuid(),v_daycare,v_owner,v_daycare::text||'/wrong-id.csv',repeat('a',64)));
  v_pdf:=gen_random_uuid();
  insert into public.report_exports(id,daycare_id,created_by,report_kind,title,format,storage_path,content_sha256,content_bytes)
    values(v_pdf,v_daycare,v_owner,'incidents','PDF archive shape','pdf',v_daycare::text||'/'||v_pdf::text||'.pdf',repeat('a',64),4);
  if (select storage_path from public.report_exports where id=v_pdf) <> v_daycare::text||'/'||v_pdf::text||'.pdf' then
    raise exception 'FAIL: PDF archive path was not recorded';
  end if;
  v_scheduled_pdf:=gen_random_uuid();
  v_duplicate_pdf:=gen_random_uuid();
  insert into public.report_exports(id,daycare_id,created_by,report_kind,title,starts_on,ends_on,format,parameters,storage_path,content_sha256,content_bytes)
    values(v_scheduled_pdf,v_daycare,v_owner,'incidents','Scheduled PDF','2026-10-01','2026-10-15','pdf',
      jsonb_build_object('scheduled',true,'schedule_id',v_schedule),
      v_daycare::text||'/'||v_scheduled_pdf::text||'.pdf',repeat('a',64),4);
  perform pg_temp.expect_denied(format(
    'insert into public.report_exports(id,daycare_id,created_by,report_kind,title,starts_on,ends_on,format,parameters,storage_path,content_sha256,content_bytes) values(%L,%L,%L,''incidents'',''Duplicate scheduled PDF'',''2026-10-01'',''2026-10-15'',''pdf'',%L::jsonb,%L,%L,4)',
    v_duplicate_pdf,v_daycare,v_owner,
    jsonb_build_object('scheduled',true,'schedule_id',v_schedule)::text,
    v_daycare::text||'/'||v_duplicate_pdf::text||'.pdf',repeat('b',64)));
  if not exists(select 1 from public.audit_log where entity_id=v_export and action='report.exported') then
    raise exception 'FAIL: export audit entry missing';
  end if;
  if not exists(select 1 from public.audit_log where entity_id=v_schedule and action='report_schedule.updated') then
    raise exception 'FAIL: schedule update audit entry missing';
  end if;

  perform pg_temp.impersonate('postgres');
  if (select archived_files from public.report_archive_retention_health()) < 2 then
    raise exception 'FAIL: archive health check did not count saved metadata';
  end if;
  perform pg_temp.expect_denied(format(
    'update public.report_exports set title=''Privileged change'' where id=%L',v_export));
  perform pg_temp.expect_denied(format(
    'delete from public.report_exports where id=%L',v_export));
  update public.report_schedules set active=true where id=v_schedule;
  update public.report_schedules set next_run_at=now()-interval '1 minute' where id=v_schedule;
  select (s.next_run_at at time zone coalesce(d.timezone,'UTC'))::date
    into v_run_on from public.report_schedules s
    join public.daycares d on d.id=s.daycare_id where s.id=v_schedule;
  select starts_on,ends_on into v_start,v_end
    from public.report_schedule_period('weekly',1,v_run_on);
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
    select 1 from public.notification_outbox
      where dedupe_key like 'report-schedule:'||v_schedule::text||':%'
        and recipient_id=v_owner
        and payload->>'startsOn'=v_start::text
        and payload->>'endsOn'=v_end::text
  ) then raise exception 'FAIL: scheduled reminder has an incorrect report period'; end if;
  if exists(
    select 1 from public.report_exports
      where parameters->>'schedule_id'=v_schedule::text and storage_path is null
  ) then raise exception 'FAIL: scheduled reminder was recorded as a generated export'; end if;

  perform pg_temp.impersonate('authenticated',v_parent);
  if exists(select 1 from public.report_exports where id=v_export) then
    raise exception 'FAIL: parent can read report export history';
  end if;
  perform pg_temp.expect_denied(format(
    'insert into public.report_exports(daycare_id,created_by,report_kind,title,format) values(%L,%L,''attendance'',''Forbidden'',''csv'')',v_daycare,v_parent));
end $$;
rollback;
select 'PASS: Group 13 schedules advance, queue reminders without fake exports, audit real exports, and enforce role/tenant boundaries' as result;
