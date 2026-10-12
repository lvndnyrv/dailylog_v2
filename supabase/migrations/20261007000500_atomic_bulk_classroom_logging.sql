-- Quick Log actions must apply to the selected group as one operation. A
-- validation failure for one child must not leave the rest of the room changed.

create or replace function public.bulk_log_daily_updates(
  p_child_ids uuid[],
  p_kind text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_today date := public.center_today();
  v_child_ids uuid[];
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_selected integer;
  v_accessible integer;
  v_affected integer := 0;
  v_time time;
  v_menu_id uuid;
  v_text text;
  v_values text[];
  v_logs jsonb;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('daily_logs', 'edit') then
    raise exception 'Daily log edit permission is required';
  end if;

  select array_agg(distinct requested.child_id)
    into v_child_ids
    from unnest(coalesce(p_child_ids, array[]::uuid[])) requested(child_id)
   where requested.child_id is not null;
  v_selected := coalesce(cardinality(v_child_ids), 0);
  if v_selected = 0 then raise exception 'Choose at least one child'; end if;
  if v_selected > 50 then raise exception 'Choose no more than 50 children at once'; end if;

  select count(*)::integer into v_accessible
    from public.children child
   where child.id = any(v_child_ids)
     and child.daycare_id = v_daycare
     and child.archived_at is null
     and coalesce(child.enrolled_on, '-infinity'::date) <= v_today
     and public.can_access_child_area(child.id, 'daily_logs', 'edit');
  if v_accessible <> v_selected then
    raise exception 'One or more children are unavailable or outside your assignment';
  end if;

  insert into public.daily_logs (
    daycare_id, child_id, educator_id, log_date
  )
  select v_daycare, child.id, auth.uid(), v_today
    from public.children child
   where child.id = any(v_child_ids)
  on conflict (child_id, log_date) do nothing;

  perform 1
    from public.daily_logs daily_log
   where daily_log.child_id = any(v_child_ids)
     and daily_log.log_date = v_today
   for update;

  if (select count(*) from public.daily_logs daily_log
       where daily_log.child_id = any(v_child_ids)
         and daily_log.log_date = v_today) <> v_selected then
    raise exception 'Some daily reports could not be prepared';
  end if;
  if exists (
    select 1 from public.daily_logs daily_log
     where daily_log.child_id = any(v_child_ids)
       and daily_log.log_date = v_today
       and coalesce(daily_log.sent_to_parents, false)
  ) then
    raise exception 'A selected child already has a final daily report';
  end if;

  if v_kind = 'photo_prepare' then
    if exists (
      select 1 from unnest(v_child_ids) selected(child_id)
       where not public.child_has_active_consent(
         selected.child_id, 'Photo & media consent'
       )
    ) then
      raise exception 'Photo permission is missing or declined for a selected child';
    end if;
    select jsonb_agg(jsonb_build_object(
      'childId', daily_log.child_id,
      'logId', daily_log.id
    ) order by daily_log.child_id)
      into v_logs
      from public.daily_logs daily_log
     where daily_log.child_id = any(v_child_ids)
       and daily_log.log_date = v_today;
    return jsonb_build_object(
      'selectedCount', v_selected,
      'affectedCount', 0,
      'logs', coalesce(v_logs, '[]'::jsonb)
    );
  elsif v_kind = 'meal' then
    v_text := nullif(btrim(p_payload->>'foodType'), '');
    if v_text is null then raise exception 'Enter what was served before saving'; end if;
    if char_length(v_text) > 250 then raise exception 'Meal description is too long'; end if;
    begin
      v_time := coalesce(nullif(p_payload->>'time', '')::time, localtime::time);
      v_menu_id := nullif(p_payload->>'mealMenuItemId', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Meal time or menu item is invalid';
    end;
    if exists (
      select 1 from unnest(v_child_ids) selected(child_id)
       where coalesce(p_payload->'amounts'->>selected.child_id::text, '')
         not in ('all', 'some', 'none')
    ) then raise exception 'Choose how much every selected child ate'; end if;
    if v_menu_id is not null and not exists (
      select 1 from public.meal_menu_items menu
       where menu.id = v_menu_id
         and menu.daycare_id = v_daycare
         and menu.menu_date = v_today
         and not exists (
           select 1 from public.children child
            where child.id = any(v_child_ids)
              and menu.classroom_id is not null
              and menu.classroom_id is distinct from child.classroom_id
         )
    ) then raise exception 'This meal menu item is not available for every selected child'; end if;

    if v_menu_id is null then
      insert into public.meal_entries (daily_log_id, time, food_type, amount)
      select daily_log.id, v_time, v_text,
        p_payload->'amounts'->>daily_log.child_id::text
        from public.daily_logs daily_log
       where daily_log.child_id = any(v_child_ids)
         and daily_log.log_date = v_today;
    else
      insert into public.meal_entries (
        daily_log_id, time, food_type, amount, meal_menu_item_id
      )
      select daily_log.id, v_time, v_text,
        p_payload->'amounts'->>daily_log.child_id::text, v_menu_id
        from public.daily_logs daily_log
       where daily_log.child_id = any(v_child_ids)
         and daily_log.log_date = v_today
      on conflict (daily_log_id, meal_menu_item_id) do update set
        time = excluded.time,
        food_type = excluded.food_type,
        amount = excluded.amount;
    end if;
    get diagnostics v_affected = row_count;
  elsif v_kind = 'nap_start' then
    begin
      v_time := coalesce(nullif(p_payload->>'time', '')::time, localtime::time);
    exception when invalid_text_representation then raise exception 'Nap time is invalid'; end;
    insert into public.sleep_entries (daily_log_id, start_time)
    select daily_log.id, v_time
      from public.daily_logs daily_log
     where daily_log.child_id = any(v_child_ids)
       and daily_log.log_date = v_today
       and not exists (
         select 1 from public.sleep_entries sleep
          where sleep.daily_log_id = daily_log.id and sleep.end_time is null
       );
    get diagnostics v_affected = row_count;
  elsif v_kind = 'nap_end' then
    begin
      v_time := coalesce(nullif(p_payload->>'time', '')::time, localtime::time);
    exception when invalid_text_representation then raise exception 'Nap time is invalid'; end;
    with latest as (
      select distinct on (sleep.daily_log_id) sleep.id
        from public.sleep_entries sleep
        join public.daily_logs daily_log on daily_log.id = sleep.daily_log_id
       where daily_log.child_id = any(v_child_ids)
         and daily_log.log_date = v_today
         and sleep.end_time is null
       order by sleep.daily_log_id, sleep.created_at desc, sleep.id desc
    )
    update public.sleep_entries sleep
       set end_time = v_time
      from latest
     where sleep.id = latest.id;
    get diagnostics v_affected = row_count;
    if v_affected = 0 then raise exception 'None of the selected children has an active nap'; end if;
  elsif v_kind = 'diaper' then
    if coalesce(p_payload->>'type', '') not in ('diaper', 'toilet') then
      raise exception 'Choose diaper or toilet';
    end if;
    if coalesce(p_payload->>'result', '') not in ('wet', 'bm', 'dry') then
      raise exception 'Choose a care result';
    end if;
    begin
      v_time := coalesce(nullif(p_payload->>'time', '')::time, localtime::time);
    exception when invalid_text_representation then raise exception 'Care time is invalid'; end;
    insert into public.diaper_entries (daily_log_id, time, type, wet, bm)
    select daily_log.id, v_time, p_payload->>'type',
      p_payload->>'result' = 'wet', p_payload->>'result' = 'bm'
      from public.daily_logs daily_log
     where daily_log.child_id = any(v_child_ids)
       and daily_log.log_date = v_today;
    get diagnostics v_affected = row_count;
  elsif v_kind = 'activity' then
    select array_agg(distinct btrim(value)) into v_values
      from jsonb_array_elements_text(coalesce(p_payload->'activities', '[]'::jsonb)) item(value)
     where nullif(btrim(value), '') is not null;
    if coalesce(cardinality(v_values), 0) = 0 then
      raise exception 'Select at least one activity before saving';
    end if;
    if cardinality(v_values) > 20 or exists (
      select 1 from unnest(v_values) value where char_length(value) > 100
    ) then raise exception 'Activity selection is too large'; end if;
    insert into public.activity_entries (daily_log_id, activity_name)
    select daily_log.id, activity.name
      from public.daily_logs daily_log
      cross join unnest(v_values) activity(name)
     where daily_log.child_id = any(v_child_ids)
       and daily_log.log_date = v_today
       and not exists (
         select 1 from public.activity_entries existing
          where existing.daily_log_id = daily_log.id
            and existing.activity_name = activity.name
       );
    get diagnostics v_affected = row_count;
  elsif v_kind = 'mood' then
    v_text := nullif(btrim(p_payload->>'mood'), '');
    if v_text not in ('Happy', 'Fussy', 'Curious', 'Irritable', 'Sleepy', 'Sick') then
      raise exception 'Choose a valid mood before saving';
    end if;
    update public.daily_logs daily_log
       set moods = array_append(coalesce(daily_log.moods, array[]::text[]), v_text)
     where daily_log.child_id = any(v_child_ids)
       and daily_log.log_date = v_today
       and not (v_text = any(coalesce(daily_log.moods, array[]::text[])));
    get diagnostics v_affected = row_count;
  elsif v_kind = 'note' then
    v_text := nullif(btrim(p_payload->>'note'), '');
    if v_text is null then raise exception 'Write a note before saving'; end if;
    if char_length(v_text) > 1000 then raise exception 'Note must be 1000 characters or fewer'; end if;
    update public.daily_logs daily_log
       set notes = case
         when nullif(btrim(daily_log.notes), '') is null then v_text
         else btrim(daily_log.notes) || E'\n' || v_text
       end
     where daily_log.child_id = any(v_child_ids)
       and daily_log.log_date = v_today
       and not (string_to_array(coalesce(daily_log.notes, ''), E'\n') @> array[v_text]);
    get diagnostics v_affected = row_count;
  else
    raise exception 'Unsupported bulk daily log action';
  end if;

  return jsonb_build_object(
    'selectedCount', v_selected,
    'affectedCount', v_affected,
    'skippedCount', greatest(v_selected - v_affected, 0)
  );
end;
$$;

create or replace function public.bulk_set_mobile_attendance(
  p_child_ids uuid[],
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_today date := public.center_today();
  v_child_ids uuid[];
  v_selected integer;
  v_accessible integer;
  v_affected integer := 0;
  v_action text := lower(btrim(coalesce(p_action, '')));
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit') then
    raise exception 'Attendance edit permission is required';
  end if;
  select array_agg(distinct requested.child_id) into v_child_ids
    from unnest(coalesce(p_child_ids, array[]::uuid[])) requested(child_id)
   where requested.child_id is not null;
  v_selected := coalesce(cardinality(v_child_ids), 0);
  if v_selected = 0 then raise exception 'Choose at least one child'; end if;
  if v_selected > 50 then raise exception 'Choose no more than 50 children at once'; end if;
  select count(*)::integer into v_accessible
    from public.children child
   where child.id = any(v_child_ids)
     and child.daycare_id = v_daycare
     and child.archived_at is null
     and coalesce(child.enrolled_on, '-infinity'::date) <= v_today
     and public.can_access_child_area(child.id, 'attendance', 'edit');
  if v_accessible <> v_selected then
    raise exception 'One or more children are unavailable or outside your assignment';
  end if;

  if v_action = 'check-in' then
    insert into public.attendance_records (
      daycare_id, child_id, date, checked_in_at, checked_in_by,
      method, status, absence_reason, notes
    )
    select v_daycare, child.id, v_today, now(), auth.uid(),
      'educator', 'present', null, null
      from public.children child
     where child.id = any(v_child_ids)
    on conflict (child_id, date) do update set
      checked_in_at = excluded.checked_in_at,
      checked_in_by = excluded.checked_in_by,
      method = 'educator',
      status = 'present',
      absence_reason = null,
      notes = null
    where public.attendance_records.checked_in_at is null
      and public.attendance_records.checked_out_at is null;
    get diagnostics v_affected = row_count;
  elsif v_action = 'check-out' then
    update public.attendance_records attendance
       set checked_out_at = now(), checked_out_by = auth.uid()
     where attendance.child_id = any(v_child_ids)
       and attendance.date = v_today
       and attendance.checked_in_at is not null
       and attendance.checked_out_at is null;
    get diagnostics v_affected = row_count;
    if v_affected = 0 then
      raise exception 'None of the selected children has an active check-in';
    end if;
  else
    raise exception 'Choose check-in or check-out';
  end if;

  return jsonb_build_object(
    'selectedCount', v_selected,
    'affectedCount', v_affected,
    'skippedCount', v_selected - v_affected
  );
end;
$$;

create or replace function public.attach_bulk_daily_log_photos(
  p_items jsonb,
  p_caption text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('daily_logs', 'edit') then
    raise exception 'Daily log edit permission is required';
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Photo list is invalid'; end if;
  v_count := jsonb_array_length(p_items);
  if v_count = 0 or v_count > 50 then raise exception 'Choose between 1 and 50 photos'; end if;
  if char_length(coalesce(v_caption, '')) > 500 then raise exception 'Photo caption is too long'; end if;

  if (
    select count(*) from (
      select distinct item.child_id, item.log_id, item.storage_path
        from jsonb_to_recordset(p_items) as item(
          child_id uuid, log_id uuid, storage_path text
        )
    ) unique_item
  ) <> v_count then raise exception 'Photo list contains duplicates'; end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_items) as item(
        child_id uuid, log_id uuid, storage_path text
      )
      left join public.daily_logs daily_log
        on daily_log.id = item.log_id and daily_log.child_id = item.child_id
     where daily_log.id is null
        or daily_log.log_date <> public.center_today()
        or coalesce(daily_log.sent_to_parents, false)
        or not public.can_access_child_area(item.child_id, 'daily_logs', 'edit')
        or not public.child_has_active_consent(item.child_id, 'Photo & media consent')
        or item.storage_path not like item.child_id::text || '/' || item.log_id::text || '/%'
        or array_length(string_to_array(item.storage_path, '/'), 1) <> 3
  ) then raise exception 'A photo does not match an editable, consented daily report'; end if;

  insert into public.photos (daily_log_id, storage_path, caption, uploader_id)
  select item.log_id, item.storage_path, v_caption, auth.uid()
    from jsonb_to_recordset(p_items) as item(
      child_id uuid, log_id uuid, storage_path text
    );
  get diagnostics v_count = row_count;
  return jsonb_build_object('affectedCount', v_count);
end;
$$;

revoke all on function public.bulk_log_daily_updates(uuid[], text, jsonb) from public, anon;
revoke all on function public.bulk_set_mobile_attendance(uuid[], text) from public, anon;
revoke all on function public.attach_bulk_daily_log_photos(jsonb, text) from public, anon;
grant execute on function public.bulk_log_daily_updates(uuid[], text, jsonb) to authenticated;
grant execute on function public.bulk_set_mobile_attendance(uuid[], text) to authenticated;
grant execute on function public.attach_bulk_daily_log_photos(jsonb, text) to authenticated;

-- The legacy helper silently skipped unauthorized logs and was executable by
-- default. Keep compatibility while applying the same explicit boundary.
revoke all on function public.bulk_set_moods(uuid[], text[]) from public, anon, authenticated;

notify pgrst, 'reload schema';
