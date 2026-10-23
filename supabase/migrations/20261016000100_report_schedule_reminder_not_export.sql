-- A scheduled reminder does not create a PDF/CSV file. Do not record one as
-- report.exported until a real generated artifact exists.
create or replace function public.process_due_report_schedules()
returns integer language plpgsql security definer set search_path=public as $$
declare
  v_schedule public.report_schedules%rowtype;
  v_recipient record;
  v_zone text;
  v_local_run date;
  v_start date;
  v_end date;
  v_rows integer;
  v_title text;
  v_count integer:=0;
begin
  for v_schedule in
    select * from public.report_schedules
      where active and next_run_at<=clock_timestamp()
      order by next_run_at for update skip locked
  loop
    select coalesce(timezone,'UTC') into v_zone
      from public.daycares where id=v_schedule.daycare_id;
    v_local_run:=(v_schedule.next_run_at at time zone v_zone)::date;
    v_end:=v_local_run-1;
    v_start:=case v_schedule.cadence
      when 'weekly' then v_end-6
      when 'monthly' then date_trunc('month',v_end)::date
      else date_trunc('quarter',v_end)::date end;
    v_rows:=public._scheduled_report_row_count(
      v_schedule.daycare_id,v_schedule.report_kind,v_start,v_end
    );
    v_title:=case v_schedule.report_kind
      when 'attendance' then 'Attendance summary'
      when 'billing' then 'Revenue & billing'
      when 'ratio' then 'Ratio compliance'
      when 'timesheets' then 'Staff hours & timesheets'
      when 'incidents' then 'Incident log'
      else 'Enrollment funnel' end;

    if not v_schedule.skip_empty or v_rows>0 then
      for v_recipient in
        select p.id,p.email from public.profiles p
          where p.id=any(v_schedule.recipient_ids)
            and p.daycare_id=v_schedule.daycare_id
            and p.role in ('owner_admin','admin') and p.archived_at is null
      loop
        insert into public.notification_outbox(
          daycare_id,recipient_id,recipient_email,channel,kind,title,body,payload,dedupe_key
        ) values(
          v_schedule.daycare_id,v_recipient.id,v_recipient.email,'email','scheduled_report',
          v_title||' is ready',
          format('Your scheduled %s report for %s through %s is ready in DailyLog.',
            lower(v_title),v_start,v_end),
          jsonb_build_object(
            'type','scheduled_report','reportKind',v_schedule.report_kind,
            'startsOn',v_start,'endsOn',v_end,'formats',v_schedule.formats,
            'reportPath',format('/reports/%s?from=%s&to=%s',v_schedule.report_kind,v_start,v_end),
            'csvPath',format('/reports-export/%s?from=%s&to=%s',
              case v_schedule.report_kind when 'attendance' then 'attendance-summary'
                when 'billing' then 'invoices' else v_schedule.report_kind end,v_start,v_end)
          ),
          format('report-schedule:%s:%s:%s:%s',v_schedule.id,v_start,v_end,v_recipient.id)
        ) on conflict do nothing;
      end loop;
    end if;

    -- Mentioning a timing column deliberately re-runs the next-run trigger.
    update public.report_schedules set
      last_run_at=clock_timestamp(),last_error=null,delivery_time=delivery_time
      where id=v_schedule.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
