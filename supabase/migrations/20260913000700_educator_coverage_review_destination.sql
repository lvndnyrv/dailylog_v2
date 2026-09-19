-- Complete the educator destination for proactive coverage-review alerts.
-- The assignment remains a human-owned commitment, but a stale invitation can
-- no longer appear safe to accept while an administrator is reviewing it.

drop function if exists public.get_my_room_coverage();

create function public.get_my_room_coverage()
returns table(
  id uuid,
  room_id uuid,
  room_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  notes text,
  timezone text,
  review_issue text,
  review_issue_detected_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select assignment.id,
         assignment.classroom_id,
         room.name,
         assignment.starts_at,
         assignment.ends_at,
         assignment.status,
         assignment.notes,
         center.timezone,
         assignment.review_issue,
         assignment.review_issue_detected_at
    from public.room_coverage_assignments assignment
    join public.staff_members member on member.id = assignment.staff_member_id
    join public.profiles profile on profile.id = member.profile_id
    join public.classrooms room on room.id = assignment.classroom_id
    join public.daycares center on center.id = assignment.daycare_id
   where profile.id = auth.uid()
     and profile.role = 'educator'
     and profile.archived_at is null
     and member.archived_at is null
     and member.status = 'active'
     and assignment.daycare_id = profile.daycare_id
     and member.daycare_id = profile.daycare_id
     and assignment.ends_at > now()
     and assignment.starts_at < now() + interval '91 days'
     and assignment.status in ('assigned', 'accepted', 'declined', 'cancelled')
   order by assignment.starts_at, assignment.id;
$$;

revoke all on function public.get_my_room_coverage()
  from public, anon;
grant execute on function public.get_my_room_coverage()
  to authenticated;

notify pgrst, 'reload schema';
