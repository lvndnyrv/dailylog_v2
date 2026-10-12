-- Enrollment -> educator attendance handoff: operational roll call must not
-- expose a future child before the agreed first day. The underlying Group 23
-- builder is retained privately; this wrapper applies the lifecycle boundary
-- and recomputes its summary from the visible rows.

alter function public.get_mobile_roll_call(uuid)
  rename to _get_mobile_roll_call_without_enrollment_boundary;

revoke all on function public._get_mobile_roll_call_without_enrollment_boundary(uuid)
  from public, anon, authenticated, service_role;

create function public.get_mobile_roll_call(p_classroom_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw jsonb;
  v_children jsonb;
  v_present integer;
  v_absent integer;
  v_awaited integer;
  v_departed integer;
begin
  v_raw := public._get_mobile_roll_call_without_enrollment_boundary(p_classroom_id);

  with visible as (
    select item
      from jsonb_array_elements(coalesce(v_raw -> 'children', '[]'::jsonb)) item
     where exists (
       select 1
         from public.children child
        where child.id = (item ->> 'id')::uuid
          and coalesce(child.enrolled_on, '-infinity'::date) <= public.center_today()
     )
  )
  select
    coalesce(jsonb_agg(item), '[]'::jsonb),
    count(*) filter (where item ->> 'rollStatus' = 'present')::integer,
    count(*) filter (where item ->> 'rollStatus' = 'absent')::integer,
    count(*) filter (where item ->> 'rollStatus' in ('awaited', 'coming'))::integer,
    count(*) filter (where item ->> 'rollStatus' = 'departed')::integer
    into v_children, v_present, v_absent, v_awaited, v_departed
    from visible;

  return v_raw || jsonb_build_object(
    'summary', jsonb_build_object(
      'present', coalesce(v_present, 0),
      'absent', coalesce(v_absent, 0),
      'awaited', coalesce(v_awaited, 0),
      'departed', coalesce(v_departed, 0)
    ),
    'children', coalesce(v_children, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_mobile_roll_call(uuid) from public, anon;
grant execute on function public.get_mobile_roll_call(uuid) to authenticated;

notify pgrst, 'reload schema';
