-- Roll call follows the live operating group without changing home assignments.
-- Keep the existing per-room builder private; it already enforces center, room and
-- attendance-view access before returning any child data.
create or replace function public.get_mobile_roll_call(p_classroom_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_host_id uuid;
  v_source_id uuid;
  v_host jsonb;
  v_source jsonb;
  v_children jsonb;
  v_present integer;
  v_absent integer;
  v_awaited integer;
  v_departed integer;
begin
  v_host_id := public._operating_room_id(p_classroom_id);
  -- The private builder checks access to the requested room. Do not resolve a
  -- partner roster until that check has succeeded.
  v_host := public._get_mobile_roll_call_without_enrollment_boundary(p_classroom_id);
  if v_host_id <> p_classroom_id then
    v_host := public._get_mobile_roll_call_without_enrollment_boundary(v_host_id);
  end if;

  select c.source_classroom_id into v_source_id
    from public._active_room_combination(v_host_id) c
   where c.host_classroom_id = v_host_id;
  if v_source_id is not null then
    v_source := public._get_mobile_roll_call_without_enrollment_boundary(v_source_id);
  end if;

  with combined as (
    select item, v_host -> 'classroom' ->> 'name' as home_name
      from jsonb_array_elements(coalesce(v_host -> 'children', '[]'::jsonb)) item
    union all
    select item, v_source -> 'classroom' ->> 'name' as home_name
      from jsonb_array_elements(coalesce(v_source -> 'children', '[]'::jsonb)) item
  ), visible as (
    select item || jsonb_build_object('homeRoomName', home_name) as item
      from combined
     where exists (
       select 1 from public.children child
        where child.id = (item ->> 'id')::uuid
          and coalesce(child.enrolled_on, '-infinity'::date) <= public.center_today()
     )
  )
  select coalesce(jsonb_agg(item order by item ->> 'fullName'), '[]'::jsonb),
    count(*) filter (where item ->> 'rollStatus' = 'present')::integer,
    count(*) filter (where item ->> 'rollStatus' = 'absent')::integer,
    count(*) filter (where item ->> 'rollStatus' in ('awaited', 'coming'))::integer,
    count(*) filter (where item ->> 'rollStatus' = 'departed')::integer
  into v_children, v_present, v_absent, v_awaited, v_departed
  from visible;

  return v_host || jsonb_build_object(
    'operatingRoomId', v_host_id,
    'combined', v_source_id is not null,
    'summary', jsonb_build_object('present', v_present, 'absent', v_absent,
      'awaited', v_awaited, 'departed', v_departed),
    'children', v_children
  );
end;
$$;

create or replace function public.complete_mobile_roll_call(p_classroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_today date := public.center_today();
  v_roll jsonb;
  v_host_id uuid;
  v_summary jsonb;
  v_session public.mobile_roll_call_sessions%rowtype;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit') then
    raise exception 'Attendance edit permission is required';
  end if;
  -- Reuse the same scoped, first-day-filtered roster shown to the educator.
  v_roll := public.get_mobile_roll_call(p_classroom_id);
  v_host_id := (v_roll ->> 'operatingRoomId')::uuid;
  v_summary := v_roll -> 'summary';
  insert into public.mobile_roll_call_sessions (
    daycare_id, classroom_id, attendance_date, completed_by, completed_at,
    present_count, absent_count, awaited_count
  ) values (
    v_daycare_id, v_host_id, v_today, auth.uid(), now(),
    (v_summary ->> 'present')::integer,
    (v_summary ->> 'absent')::integer,
    (v_summary ->> 'awaited')::integer
  )
  on conflict (classroom_id, attendance_date) do update set
    completed_by = excluded.completed_by,
    completed_at = excluded.completed_at,
    present_count = excluded.present_count,
    absent_count = excluded.absent_count,
    awaited_count = excluded.awaited_count
  returning * into v_session;

  return jsonb_build_object('id', v_session.id,
    'completedAt', v_session.completed_at,
    'present', v_session.present_count,
    'absent', v_session.absent_count,
    'awaited', v_session.awaited_count);
end;
$$;

revoke all on function public.get_mobile_roll_call(uuid), public.complete_mobile_roll_call(uuid)
  from public, anon;
grant execute on function public.get_mobile_roll_call(uuid), public.complete_mobile_roll_call(uuid)
  to authenticated;
notify pgrst, 'reload schema';
