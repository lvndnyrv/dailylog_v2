-- Parent Groups 5–6 fixture and RLS smoke test. Read-only and rollback-safe.

begin;

do $$
declare
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_week_start date := (date_trunc('week', public.center_today()) - interval '7 days')::date;
  v_log_count integer;
  v_entry_count integer;
  v_other_children integer;
begin
  perform set_config('request.jwt.claim.sub', v_parent::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  select count(*) into v_log_count
  from public.daily_logs log
  where log.child_id = v_child
    and log.log_date between v_week_start and v_week_start + 4
    and log.sent_to_parents;
  if v_log_count <> 5 then
    raise exception 'FAIL: expected 5 completed prior-week logs, got %', v_log_count;
  end if;

  select count(*) into v_entry_count
  from public.meal_entries meal
  join public.daily_logs log on log.id = meal.daily_log_id
  where log.child_id = v_child
    and log.log_date between v_week_start and v_week_start + 4;
  if v_entry_count <> 15 then
    raise exception 'FAIL: expected 15 prior-week meal entries, got %', v_entry_count;
  end if;

  select count(*) into v_other_children
  from public.daily_logs log
  where log.child_id <> v_child;
  if v_other_children <> 0 then
    raise exception 'FAIL: parent can read another family''s daily logs';
  end if;

  if not exists (
    select 1
    from public.attendance_records attendance
    where attendance.child_id = v_child
      and attendance.date = public.center_today()
  ) then
    raise exception 'FAIL: current-day attendance state is missing';
  end if;

  raise notice 'MOBILE PARENT GROUPS 5-6 TESTS: ALL PASSED';
end;
$$;

rollback;
