-- Match the ratio preview's half-open interval overlap rule. An interval
-- ending exactly at period start has no observed time inside the report.
create or replace function public._scheduled_report_row_count(
  p_daycare uuid,p_kind text,p_start date,p_end date
) returns integer language plpgsql stable security definer set search_path=public as $$
declare v_count integer;v_zone text;
begin
  select coalesce(timezone,'UTC') into v_zone from public.daycares where id=p_daycare;
  if p_kind='attendance' then
    select count(*) into v_count from public.attendance_records
      where daycare_id=p_daycare and date between p_start and p_end;
  elsif p_kind='billing' then
    select count(*) into v_count from public.invoices
      where daycare_id=p_daycare and issued_on between p_start and p_end;
  elsif p_kind='ratio' then
    select count(*) into v_count from public.room_ratio_history
      where daycare_id=p_daycare and source<>'legacy_event'
        and starts_at<((p_end+1)::timestamp at time zone v_zone)
        and (ends_at is null or ends_at>(p_start::timestamp at time zone v_zone));
  elsif p_kind='timesheets' then
    select count(*) into v_count from public.staff_time_entries
      where daycare_id=p_daycare
        and clocked_in_at<((p_end+1)::timestamp at time zone v_zone)
        and clocked_in_at>=(p_start::timestamp at time zone v_zone);
  elsif p_kind='incidents' then
    select count(*) into v_count from public.incident_reports
      where daycare_id=p_daycare and status<>'draft'
        and occurred_at<((p_end+1)::timestamp at time zone v_zone)
        and occurred_at>=(p_start::timestamp at time zone v_zone);
  elsif p_kind='enrollment' then
    select count(*) into v_count from public.enrollments
      where daycare_id=p_daycare
        and created_at<((p_end+1)::timestamp at time zone v_zone)
        and created_at>=(p_start::timestamp at time zone v_zone);
  else
    raise exception 'Unsupported report kind';
  end if;
  return coalesce(v_count,0);
end $$;
