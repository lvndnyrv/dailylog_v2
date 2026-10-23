-- A schedule sent after the first day of a month/quarter must include the
-- entire interval since its previous scheduled date. Calendar-boundary
-- starts silently omitted the middle of each period.
create function public.report_schedule_period(
  p_cadence text, p_delivery_day integer, p_run_on date
)
returns table(starts_on date, ends_on date)
language plpgsql immutable set search_path=public as $$
declare
  v_previous_month date;
  v_last_day integer;
begin
  if p_run_on is null then raise exception 'A scheduled run date is required'; end if;
  if p_cadence='weekly' then
    if p_delivery_day not between 0 and 6 then
      raise exception 'Invalid weekly delivery day';
    end if;
    starts_on:=p_run_on-7;
  elsif p_cadence in ('monthly','quarterly') then
    if p_delivery_day not between 1 and 31 then
      raise exception 'Invalid monthly delivery day';
    end if;
    v_previous_month:=date_trunc('month',p_run_on::timestamp
      - case when p_cadence='quarterly' then interval '3 months'
        else interval '1 month' end)::date;
    v_last_day:=extract(day from (v_previous_month+interval '1 month - 1 day'))::integer;
    starts_on:=v_previous_month+least(p_delivery_day,v_last_day)-1;
  else
    raise exception 'Unsupported report cadence';
  end if;
  ends_on:=p_run_on-1;
  return next;
end $$;

revoke all on function public.report_schedule_period(text,integer,date)
  from public,anon,authenticated;
grant execute on function public.report_schedule_period(text,integer,date) to service_role;

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
    select period.starts_on,period.ends_on into v_start,v_end
      from public.report_schedule_period(
        v_schedule.cadence,v_schedule.delivery_day,v_local_run
      ) period;
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
