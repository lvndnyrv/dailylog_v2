-- Final daily reports require a meaningful educator update. This keeps an
-- accidental empty draft from becoming the family's final recap while
-- preserving the atomic, retry-safe publication and delivery behavior.

create or replace function public.publish_daily_log(p_daily_log_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.daily_logs%rowtype;
  v_child public.children%rowtype;
  v_sent_at timestamptz;
  v_queued integer;
  v_entry_count integer;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'A signed-in staff account is required';
  end if;

  select * into v_log
    from public.daily_logs daily_log
   where daily_log.id = p_daily_log_id
   for update;
  if v_log.id is null then raise exception 'Daily log not found'; end if;
  if not public.can_access_child_area(v_log.child_id, 'daily_logs', 'edit') then
    raise exception 'Daily log edit permission is required';
  end if;
  if v_log.log_date > public.center_today() then
    raise exception 'A future daily log cannot be sent';
  end if;

  select * into v_child from public.children child where child.id = v_log.child_id;
  if v_child.id is null or v_child.archived_at is not null then
    raise exception 'Child not found or unavailable';
  end if;
  if coalesce(v_child.enrolled_on, '-infinity'::date) > v_log.log_date then
    raise exception 'A daily log cannot be sent before the enrollment start date';
  end if;

  if not coalesce(v_log.sent_to_parents, false) then
    select
      (select count(*) from public.meal_entries meal where meal.daily_log_id = v_log.id)
      + (select count(*) from public.sleep_entries sleep where sleep.daily_log_id = v_log.id)
      + (select count(*) from public.diaper_entries diaper where diaper.daily_log_id = v_log.id)
      + (select count(*) from public.activity_entries activity where activity.daily_log_id = v_log.id)
      into v_entry_count;

    if nullif(btrim(v_log.notes), '') is null
       and nullif(btrim(v_log.comments), '') is null
       and coalesce(v_entry_count, 0) < 2 then
      raise exception 'Add a note or at least two daily updates before sending the final report';
    end if;
  end if;

  v_sent_at := coalesce(v_log.sent_at, now());
  update public.daily_logs
     set sent_to_parents = true,
         sent_at = v_sent_at
   where id = v_log.id
     and (not coalesce(sent_to_parents, false) or sent_at is null);

  v_queued := public.enqueue_child_notification(
    v_log.child_id,
    'daily_log',
    v_child.first_name || '''s daily log is ready 📋',
    'Tap to see how ' || v_child.first_name || '''s day went at daycare.',
    jsonb_build_object(
      'dailyLogId', v_log.id,
      'childId', v_log.child_id,
      'logDate', v_log.log_date,
      'type', 'daily_log',
      'channelId', 'default'
    ),
    'daily-log:' || v_log.child_id || ':' || v_log.log_date,
    array['push']::text[]
  );

  return jsonb_build_object(
    'dailyLogId', v_log.id,
    'childId', v_log.child_id,
    'logDate', v_log.log_date,
    'sentAt', v_sent_at,
    'queuedRecipients', v_queued
  );
end;
$$;

revoke all on function public.publish_daily_log(uuid) from public, anon;
grant execute on function public.publish_daily_log(uuid) to authenticated;

notify pgrst, 'reload schema';

