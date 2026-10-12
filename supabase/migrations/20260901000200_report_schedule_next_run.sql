-- Keep schedule timing consistent in the center's local timezone.

create function public.set_report_schedule_next_run()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_zone text;
  v_local_now timestamp;
  v_candidate timestamp;
  v_first date;
  v_last_day integer;
  v_month_step integer;
begin
  if not new.active then
    new.next_run_at:=null;
    return new;
  end if;
  if new.cadence='weekly' and new.delivery_day not between 0 and 6 then
    raise exception 'Weekly schedules require a weekday from Sunday (0) to Saturday (6)';
  elsif new.cadence in ('monthly','quarterly') and new.delivery_day not between 1 and 31 then
    raise exception 'Monthly schedules require a day from 1 to 31';
  end if;
  select coalesce(timezone,'UTC') into v_zone from public.daycares where id=new.daycare_id;
  v_local_now:=clock_timestamp() at time zone v_zone;
  if new.cadence='weekly' then
    v_candidate:=date_trunc('day',v_local_now)
      + (((new.delivery_day-extract(dow from v_local_now)::integer)+7)%7) * interval '1 day'
      + new.delivery_time;
    if v_candidate<=v_local_now then v_candidate:=v_candidate+interval '7 days'; end if;
  else
    v_month_step:=case when new.cadence='quarterly' then 3 else 1 end;
    v_first:=date_trunc('month',v_local_now)::date;
    v_last_day:=extract(day from (v_first+interval '1 month - 1 day'))::integer;
    v_candidate:=(v_first+(least(new.delivery_day,v_last_day)-1)*interval '1 day')+new.delivery_time;
    if v_candidate<=v_local_now then
      v_first:=(v_first+(v_month_step||' months')::interval)::date;
      v_last_day:=extract(day from (v_first+interval '1 month - 1 day'))::integer;
      v_candidate:=(v_first+(least(new.delivery_day,v_last_day)-1)*interval '1 day')+new.delivery_time;
    end if;
  end if;
  new.next_run_at:=v_candidate at time zone v_zone;
  return new;
end $$;

create trigger set_report_schedule_next_run_before_write
  before insert or update of active,cadence,delivery_day,delivery_time,daycare_id
  on public.report_schedules
  for each row execute function public.set_report_schedule_next_run();

revoke all on function public.set_report_schedule_next_run()
  from public,anon,authenticated;
