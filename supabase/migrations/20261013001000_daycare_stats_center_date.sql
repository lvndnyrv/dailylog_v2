-- Keep the admin dashboard's attendance day aligned with the center-local
-- room-ratio snapshot. A database session's current_date may be tomorrow for
-- a center that is still operating today.
create or replace function public.get_daycare_stats()
returns json
language sql security definer stable
set search_path = public
as $$
  select json_build_object(
    'children', (select count(*) from public.children
                  where daycare_id = public.get_my_daycare_id() and archived_at is null),
    'classrooms', (select count(*) from public.classrooms
                    where daycare_id = public.get_my_daycare_id() and archived_at is null),
    'staff', (select count(*) from public.profiles
               where daycare_id = public.get_my_daycare_id()
                 and role in ('owner_admin', 'admin', 'educator')),
    'parents', (select count(*) from public.profiles
                 where daycare_id = public.get_my_daycare_id() and role = 'parent'),
    'present_today', (select count(*) from public.attendance_records
                       where daycare_id = public.get_my_daycare_id()
                         and date = public.center_today()
                         and checked_in_at is not null
                         and checked_out_at is null)
  )
  where public.is_admin()
$$;
