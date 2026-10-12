-- Copying yesterday's repeated routine is one retry-safe transaction. This
-- prevents double meals after repeated taps and avoids half-copied reports.

create or replace function public.copy_previous_daily_log_entries(p_target_log_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.daily_logs%rowtype;
  v_source public.daily_logs%rowtype;
  v_meal_count integer := 0;
  v_activity_count integer := 0;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'A signed-in staff account is required';
  end if;

  select * into v_target
    from public.daily_logs daily_log
   where daily_log.id = p_target_log_id
   for update;
  if v_target.id is null then
    raise exception 'Daily report not found';
  end if;
  if not public.can_access_child_area(v_target.child_id, 'daily_logs', 'edit') then
    raise exception 'Daily log edit permission is required';
  end if;
  if coalesce(v_target.sent_to_parents, false) then
    raise exception 'A final daily report cannot be changed';
  end if;

  select * into v_source
    from public.daily_logs daily_log
   where daily_log.child_id = v_target.child_id
     and daily_log.log_date = v_target.log_date - 1
   limit 1;
  if v_source.id is null then
    return jsonb_build_object(
      'copied', false,
      'reason', 'No log found for the previous day.',
      'mealCount', 0,
      'activityCount', 0
    );
  end if;

  insert into public.meal_entries (daily_log_id, time, food_type, amount)
  select v_target.id, source.time, source.food_type, source.amount
    from public.meal_entries source
   where source.daily_log_id = v_source.id
     and not exists (
       select 1 from public.meal_entries existing
        where existing.daily_log_id = v_target.id
          and existing.time is not distinct from source.time
          and existing.food_type is not distinct from source.food_type
          and existing.amount is not distinct from source.amount
     );
  get diagnostics v_meal_count = row_count;

  insert into public.activity_entries (daily_log_id, activity_name)
  select v_target.id, source.activity_name
    from public.activity_entries source
   where source.daily_log_id = v_source.id
     and not exists (
       select 1 from public.activity_entries existing
        where existing.daily_log_id = v_target.id
          and existing.activity_name is not distinct from source.activity_name
     );
  get diagnostics v_activity_count = row_count;

  return jsonb_build_object(
    'copied', true,
    'sourceLogId', v_source.id,
    'mealCount', v_meal_count,
    'activityCount', v_activity_count
  );
end;
$$;

revoke all on function public.copy_previous_daily_log_entries(uuid) from public, anon;
grant execute on function public.copy_previous_daily_log_entries(uuid) to authenticated;

comment on function public.copy_previous_daily_log_entries(uuid) is
  'Atomically and idempotently copies the previous day meals and activities into an editable daily report.';

notify pgrst, 'reload schema';
