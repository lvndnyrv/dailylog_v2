-- The planned coverage picker must not equate missing published shifts with
-- a home-room educator being spare. Borrowing needs a source-demand forecast.
alter function public.get_coverage_candidates(uuid,date,time,time) rename to _get_coverage_candidates_base;
revoke all on function public._get_coverage_candidates_base(uuid,date,time,time) from public,anon,authenticated,service_role;
create function public.get_coverage_candidates(p_room uuid,p_date date,p_start time,p_end time)
returns table(profile_id uuid,full_name text,available boolean,reason text,needs_confirmation boolean)
language sql stable security definer set search_path=public as $$
  select c.profile_id,c.full_name,c.available and not home.committed,
    case when c.available and home.committed then 'Assigned to another home room — review source-room staffing before borrowing' else c.reason end,
    c.needs_confirmation and not home.committed
  from public._get_coverage_candidates_base(p_room,p_date,p_start,p_end) c
  cross join lateral (select exists(select 1 from public.profiles p where p.id=c.profile_id and p.classroom_id is not null and p.classroom_id<>p_room)
    or exists(select 1 from public.educator_classrooms e where e.educator_id=c.profile_id and e.classroom_id<>p_room) committed) home;
$$;
revoke all on function public.get_coverage_candidates(uuid,date,time,time) from public,anon;
grant execute on function public.get_coverage_candidates(uuid,date,time,time) to authenticated;
