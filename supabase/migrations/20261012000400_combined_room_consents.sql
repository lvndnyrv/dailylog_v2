-- Consent checks must cover every child under temporary shared-room care.
-- The permanent classroom assignment remains the source of each consent row.
create or replace function public.get_mobile_classroom_consents(p_classroom_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_operating_room_id uuid;
  v_combined boolean;
  v_children jsonb;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('children', 'view') then
    raise exception 'Children view permission is required';
  end if;

  select * into v_classroom
    from public.classrooms classroom
   where classroom.id = p_classroom_id
     and classroom.daycare_id = public.get_my_daycare_id()
     and classroom.archived_at is null;
  if v_classroom.id is null then raise exception 'Classroom not found'; end if;
  if public.get_my_role() = 'educator'
     and p_classroom_id not in (select public.my_classroom_ids()) then
    raise exception 'This classroom is not assigned to you';
  end if;

  v_operating_room_id := public._operating_room_id(p_classroom_id);
  v_combined := exists(select 1 from public._active_room_combination(p_classroom_id));

  with kinds(kind, short_key) as (
    values
      ('Photo & media consent'::text, 'photos'::text),
      ('Field-trip permission', 'trips'),
      ('Water / splash play', 'water'),
      ('Sunscreen application', 'sunscreen')
  ), child_rows as (
    select child.id, btrim(child.first_name || ' ' || child.last_name) as child_name,
           child.first_name, child.photo_url, child.classroom_id,
           home.name as home_room_name,
           jsonb_object_agg(kinds.short_key, jsonb_build_object(
             'kind', kinds.kind,
             'status', case
               when latest.id is null then 'not_set'
               when latest.granted and latest.revoked_at is null then 'allowed'
               else 'declined'
             end,
             'allowed', coalesce(latest.granted and latest.revoked_at is null, false),
             'updatedAt', latest.updated_at
           )) as permissions
      from public.children child
      join public.classrooms home on home.id = child.classroom_id
      cross join kinds
      left join lateral (
        select consent.*
          from public.consents consent
         where consent.child_id = child.id and consent.kind = kinds.kind
         order by consent.updated_at desc, consent.created_at desc
         limit 1
      ) latest on true
     where child.daycare_id = v_classroom.daycare_id
       and child.archived_at is null
       and public._operating_room_id(child.classroom_id) = v_operating_room_id
       and (public.get_my_role() <> 'educator'
         or coalesce(child.enrolled_on, '-infinity'::date) <= public.center_today())
       and public.can_access_child_area(child.id, 'children', 'view')
     group by child.id, child.first_name, child.last_name, child.photo_url,
       child.classroom_id, home.name
  )
  select jsonb_agg(jsonb_build_object(
    'childId', child_rows.id,
    'childName', child_rows.child_name,
    'firstName', child_rows.first_name,
    'photoUrl', child_rows.photo_url,
    'homeRoomId', child_rows.classroom_id,
    'homeRoomName', child_rows.home_room_name,
    'permissions', child_rows.permissions
  ) order by child_rows.child_name) into v_children
    from child_rows;

  return jsonb_build_object(
    'classroomId', v_classroom.id,
    'classroomName', v_classroom.name,
    'operatingRoomId', v_operating_room_id,
    'combined', v_combined,
    'children', coalesce(v_children, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_mobile_classroom_consents(uuid) from public, anon;
grant execute on function public.get_mobile_classroom_consents(uuid) to authenticated;
notify pgrst, 'reload schema';
