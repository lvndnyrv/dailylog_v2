-- Educators may select between rooms already assigned by an administrator, but
-- they cannot turn the profile's active-room preference into a new room grant.
-- Temporary coverage continues to flow through my_classroom_ids() and is never
-- persisted to profiles.classroom_id.

create or replace function public.enforce_profile_classroom_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.classroom_id is not distinct from old.classroom_id then
    return new;
  end if;

  if auth.role() = 'service_role'
     or (auth.uid() is null and auth.role() is null) then
    return new;
  end if;

  -- Invite acceptance is the one self-service path that can establish an
  -- administrator-selected home room before the membership row is inserted.
  if new.id = auth.uid()
     and (old.daycare_id is null or old.daycare_id = new.daycare_id)
     and exists (
       select 1
         from public.staff_invites invite
        where lower(invite.email) = lower(new.email)
          and invite.daycare_id = new.daycare_id
          and invite.role = new.role
          and invite.classroom_id is not distinct from new.classroom_id
          and invite.accepted_at is null
          and (invite.expires_at is null or invite.expires_at > now())
     ) then
    return new;
  end if;

  -- An educator can change only the active preference among permanent rooms
  -- that an administrator has already assigned to them.
  if new.id = auth.uid()
     and new.role = 'educator'
     and new.daycare_id = public.get_my_daycare_id()
     and new.classroom_id is not null
     and exists (
       select 1
         from public.educator_classrooms assignment
         join public.classrooms classroom on classroom.id = assignment.classroom_id
        where assignment.educator_id = auth.uid()
          and assignment.classroom_id = new.classroom_id
          and classroom.daycare_id = new.daycare_id
          and classroom.archived_at is null
     ) then
    return new;
  end if;

  -- Staff administrators continue to own permanent room assignments.
  if public.has_permission('staff', 'edit')
     and new.daycare_id = public.get_my_daycare_id()
     and (
       new.classroom_id is null
       or exists (
         select 1
           from public.classrooms classroom
          where classroom.id = new.classroom_id
            and classroom.daycare_id = new.daycare_id
            and classroom.archived_at is null
       )
     ) then
    return new;
  end if;

  raise exception using
    errcode = '42501',
    message = 'Room assignments are managed by your center administrator.';
end;
$$;

revoke all on function public.enforce_profile_classroom_assignment()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_profile_classroom_assignment on public.profiles;
create trigger enforce_profile_classroom_assignment
  before update of classroom_id on public.profiles
  for each row execute function public.enforce_profile_classroom_assignment();
