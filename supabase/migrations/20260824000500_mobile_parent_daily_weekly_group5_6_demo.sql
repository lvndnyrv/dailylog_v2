-- Demo fixture for Parent Groups 5–6. It intentionally targets only the
-- standard Sunny Grove / Mateo fixture so non-demo centers are untouched.

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_educator constant uuid := '00000000-0000-4000-a000-000000000008';
  v_today date := public.center_today();
  v_week_start date := date_trunc('week', public.center_today())::date;
  v_previous_week date := (date_trunc('week', public.center_today()) - interval '7 days')::date;
  v_day date;
  v_log uuid;
  v_index integer;
  v_moods text[] := array['Happy', 'Curious', 'Calm', 'Happy', 'Sleepy'];
  v_activities text[] := array[
    'Watercolor garden', 'Music circle', 'Nature walk', 'Building together', 'Story workshop'
  ];
begin
  if not exists (
    select 1 from public.children child
    where child.id = v_child and child.daycare_id = v_daycare
  ) then
    return;
  end if;

  -- A complete previous week powers Summary, Story, Trends and day drill-ins.
  for v_index in 0..4 loop
    v_day := v_previous_week + v_index;

    -- Demo refreshes may land on a week containing a real center closure.
    -- Keep the fixture aligned with the operational check-in guard and leave
    -- that day empty in the family recap instead of manufacturing attendance.
    if exists (
      select 1
      from public.center_closures closure
      where closure.daycare_id = v_daycare
        and v_day between closure.starts_on and closure.ends_on
    ) then
      continue;
    end if;

    insert into public.attendance_records (
      daycare_id, child_id, date, checked_in_at, checked_in_by,
      checked_out_at, checked_out_by, method, status, notes
    ) values (
      v_daycare, v_child, v_day,
      ((v_day + time '08:08')::timestamp at time zone 'America/Toronto') + (v_index * interval '3 minutes'),
      v_educator,
      ((v_day + time '16:42')::timestamp at time zone 'America/Toronto') + (v_index * interval '4 minutes'),
      v_educator, 'educator', 'present', 'Verified at the classroom door.'
    )
    on conflict (child_id, date) do update set
      checked_in_at = excluded.checked_in_at,
      checked_in_by = excluded.checked_in_by,
      checked_out_at = excluded.checked_out_at,
      checked_out_by = excluded.checked_out_by,
      method = excluded.method,
      status = excluded.status,
      notes = excluded.notes,
      absence_reason = null;

    insert into public.daily_logs (
      daycare_id, child_id, educator_id, log_date, moods,
      notes, comments, sent_to_parents, sent_at
    ) values (
      v_daycare, v_child, v_educator, v_day, array[v_moods[v_index + 1]],
      case v_index
        when 0 then 'Mateo settled in quickly and helped prepare the art table.'
        when 1 then 'He joined every song and chose the rhythm sticks.'
        when 2 then 'He noticed three kinds of leaves on our walk.'
        when 3 then 'He worked patiently with friends on a tall block city.'
        else 'A calm finish to the week with stories and outdoor play.'
      end,
      'Please ask Mateo about his favourite part of the day.',
      true,
      ((v_day + time '17:05')::timestamp at time zone 'America/Toronto')
    )
    on conflict (child_id, log_date) do update set
      educator_id = excluded.educator_id,
      moods = excluded.moods,
      notes = excluded.notes,
      comments = excluded.comments,
      sent_to_parents = true,
      sent_at = excluded.sent_at
    returning id into v_log;

    delete from public.meal_entries where daily_log_id = v_log;
    delete from public.sleep_entries where daily_log_id = v_log;
    delete from public.diaper_entries where daily_log_id = v_log;
    delete from public.activity_entries where daily_log_id = v_log;

    insert into public.meal_entries (daily_log_id, time, food_type, amount) values
      (v_log, '08:35', 'Morning snack · berries and yogurt', 'all'),
      (v_log, '11:42', 'Lunch · vegetable pasta', case when v_index = 2 then 'some' else 'all' end),
      (v_log, '15:08', 'Afternoon snack · hummus and pita', 'some');
    insert into public.sleep_entries (daily_log_id, start_time, end_time)
      values (v_log, '12:32', time '13:42' + (v_index * interval '5 minutes'));
    insert into public.diaper_entries (daily_log_id, time, type, wet, bm)
      values (v_log, '10:18', 'toilet', false, false);
    insert into public.activity_entries (daily_log_id, activity_name)
      values (v_log, v_activities[v_index + 1]);
  end loop;

  -- A live current-day feed exercises waiting/live/latest-first states. Do not
  -- overwrite a recorded absence, because family actions must win over demos.
  if not exists (
    select 1 from public.attendance_records attendance
    where attendance.child_id = v_child
      and attendance.date = v_today
      and attendance.status in ('absent', 'excused')
  ) then
    insert into public.attendance_records (
      daycare_id, child_id, date, checked_in_at, checked_in_by,
      method, status, notes
    ) values (
      v_daycare, v_child, v_today,
      ((v_today + time '08:12')::timestamp at time zone 'America/Toronto'),
      v_educator, 'educator', 'present', 'Dropped off by Mom · verified QR.'
    )
    on conflict (child_id, date) do update set
      checked_in_at = excluded.checked_in_at,
      checked_in_by = excluded.checked_in_by,
      checked_out_at = null,
      checked_out_by = null,
      method = excluded.method,
      status = excluded.status,
      notes = excluded.notes,
      absence_reason = null;

    insert into public.daily_logs (
      daycare_id, child_id, educator_id, log_date, moods,
      notes, comments, sent_to_parents, sent_at
    ) values (
      v_daycare, v_child, v_educator, v_today, array['Happy'],
      'Mateo arrived ready to tell the class about his weekend.',
      '', false, null
    )
    on conflict (child_id, log_date) do update set
      educator_id = excluded.educator_id,
      moods = excluded.moods,
      notes = excluded.notes,
      sent_to_parents = false,
      sent_at = null
    returning id into v_log;

    delete from public.meal_entries where daily_log_id = v_log;
    delete from public.sleep_entries where daily_log_id = v_log;
    delete from public.diaper_entries where daily_log_id = v_log;
    delete from public.activity_entries where daily_log_id = v_log;

    insert into public.meal_entries (daily_log_id, time, food_type, amount) values
      (v_log, '08:37', 'Morning snack · banana oat muffin', 'all'),
      (v_log, '11:44', 'Lunch · rice, beans and vegetables', 'some');
    insert into public.sleep_entries (daily_log_id, start_time, end_time)
      values (v_log, '12:31', '13:43');
    insert into public.diaper_entries (daily_log_id, time, type, wet, bm)
      values (v_log, '10:22', 'toilet', false, false);
    insert into public.activity_entries (daily_log_id, activity_name)
      values (v_log, 'Collaborative mural');
  end if;
end;
$$;
