-- Room leadership is responsibility, not an implicit staffing transfer.
-- Coverage/shift workflows remain the authority for where an educator works.
create function public.save_room_settings(p_room_id uuid, p_settings jsonb, p_expected_updated_at timestamptz default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  center_id uuid := public.get_my_daycare_id();
  room public.classrooms%rowtype;
  result_id uuid;
  lead_id uuid;
  room_name text := btrim(p_settings->>'name');
  youngest integer; oldest integer; room_capacity integer; room_ratio integer;
  opening date; nap_from time; nap_to time;
begin
  if auth.uid() is null or center_id is null or not public.is_admin()
    or not public.has_permission('rooms','edit') then
    raise exception 'Administrator room-edit permission required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(center_id::text, 0));
  if jsonb_typeof(p_settings) is distinct from 'object' then raise exception 'Provide room settings'; end if;
  if room_name is null or length(room_name) not between 1 and 100 then
    raise exception 'Room name must contain 1–100 characters';
  end if;
  if nullif(btrim(p_settings->>'age_group'),'') is null or length(p_settings->>'age_group') > 100 then
    raise exception 'Choose an age band';
  end if;
  if coalesce(p_settings->>'min_age_months','') !~ '^[0-9]{1,3}$'
    or coalesce(p_settings->>'max_age_months','') !~ '^[0-9]{1,3}$'
    or coalesce(p_settings->>'capacity','') !~ '^[1-9][0-9]{0,3}$'
    or coalesce(p_settings->>'ratio','') !~ '^[1-9][0-9]{0,2}$' then
    raise exception 'Ages, capacity and ratio must be whole numbers; capacity and ratio must be positive';
  end if;
  youngest := (p_settings->>'min_age_months')::integer;
  oldest := (p_settings->>'max_age_months')::integer;
  room_capacity := (p_settings->>'capacity')::integer;
  room_ratio := (p_settings->>'ratio')::integer;
  if oldest <= youngest or oldest > 216 then raise exception 'Oldest age must be after youngest age and no more than 216 months'; end if;
  opening := nullif(p_settings->>'opens_on','')::date;
  nap_from := nullif(p_settings->>'nap_start','')::time;
  nap_to := nullif(p_settings->>'nap_end','')::time;
  if (nap_from is null) <> (nap_to is null) or nap_from >= nap_to then
    raise exception 'Provide both nap times, with the end after the start';
  end if;
  if p_room_id is not null then
    select * into room from public.classrooms where id=p_room_id and daycare_id=center_id
      and archived_at is null for update;
    if not found then raise exception 'This room is unavailable'; end if;
    if p_expected_updated_at is null or room.updated_at is distinct from p_expected_updated_at then
      raise exception 'This room changed while you were editing. Close and reopen it before saving';
    end if;
  end if;
  if exists(select 1 from public.classrooms where daycare_id=center_id and archived_at is null
    and lower(btrim(name))=lower(room_name) and id is distinct from p_room_id) then
    raise exception 'An active room already uses this name';
  end if;
  lead_id := nullif(p_settings->>'lead_educator_id','')::uuid;
  if lead_id is not null then
    perform 1 from public.profiles p join public.staff_members s on s.profile_id=p.id
      where p.id=lead_id and p.daycare_id=center_id and p.role='educator' and p.archived_at is null
        and s.daycare_id=center_id and s.status='active' and s.archived_at is null
        and (s.ended_on is null or s.ended_on > current_date)
      for share of p,s;
    if not found then raise exception 'Choose an active educator from your center as lead'; end if;
  end if;
  if p_room_id is null then
    insert into public.classrooms(daycare_id,name,age_group,min_age_months,max_age_months,capacity,
      ratio_children_per_educator,opens_on,nap_start,nap_end,lead_educator_id)
    values(center_id,room_name,btrim(p_settings->>'age_group'),youngest,oldest,room_capacity,
      room_ratio,opening,nap_from,nap_to,lead_id) returning id into result_id;
  else
    update public.classrooms set name=room_name,age_group=btrim(p_settings->>'age_group'),
      min_age_months=youngest,max_age_months=oldest,capacity=room_capacity,
      ratio_children_per_educator=room_ratio,opens_on=opening,nap_start=nap_from,nap_end=nap_to,
      lead_educator_id=lead_id,updated_at=clock_timestamp()
      where id=p_room_id returning id into result_id;
  end if;
  return result_id;
end; $$;
revoke all on function public.save_room_settings(uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.save_room_settings(uuid,jsonb,timestamptz) to authenticated;
