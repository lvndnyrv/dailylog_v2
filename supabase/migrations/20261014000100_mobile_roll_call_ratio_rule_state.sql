-- The ratio snapshot uses 1:1 for safety when no rule is configured. Expose
-- that distinction to roll call so the fallback is never presented as a
-- configured, compliant room rule.
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
  v_live_ratio integer;
begin
  v_host_id := public._operating_room_id(p_classroom_id);
  -- The private builder enforces room access before partner or ratio lookup.
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

  select context.live_ratio into v_live_ratio
    from public.get_room_operating_context() context
   where context.room_id = v_host_id;

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
    'ratio', coalesce(v_host -> 'ratio', '{}'::jsonb) || jsonb_build_object(
      'configured', v_live_ratio is not null,
      'configured_limit', v_live_ratio
    ),
    'summary', jsonb_build_object('present', v_present, 'absent', v_absent,
      'awaited', v_awaited, 'departed', v_departed),
    'children', v_children
  );
end;
$$;

revoke all on function public.get_mobile_roll_call(uuid) from public, anon;
grant execute on function public.get_mobile_roll_call(uuid) to authenticated;
notify pgrst, 'reload schema';
