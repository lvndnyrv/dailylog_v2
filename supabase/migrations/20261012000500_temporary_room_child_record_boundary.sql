-- Temporary coverage and room combinations grant day-to-day care access, not
-- authority to enroll children or change their permanent profile and room.
create function public.has_permanent_educator_room(p_classroom_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_classroom_id is not null
    and public.get_my_role() = 'educator'
    and exists (
      select 1 from public.classrooms room
       where room.id = p_classroom_id
         and room.daycare_id = public.get_my_daycare_id()
         and room.archived_at is null
    )
    and (
      exists (
        select 1 from public.educator_classrooms assignment
         where assignment.educator_id = auth.uid()
           and assignment.classroom_id = p_classroom_id
      )
      or exists (
        select 1 from public.profiles profile
         where profile.id = auth.uid()
           and profile.classroom_id = p_classroom_id
           and profile.daycare_id = public.get_my_daycare_id()
      )
    );
$$;

revoke all on function public.has_permanent_educator_room(uuid) from public, anon;
grant execute on function public.has_permanent_educator_room(uuid) to authenticated;

drop policy if exists "staff create children with permission" on public.children;
create policy "staff create children with permission" on public.children for insert
with check (
  public.has_permission('children', 'edit')
  and daycare_id = public.get_my_daycare_id()
  and (
    public.is_admin()
    or public.has_permanent_educator_room(classroom_id)
  )
);

drop policy if exists "staff update children with permission" on public.children;
create policy "staff update children with permission" on public.children for update
using (
  public.has_permission('children', 'edit')
  and public.can_write_child(id)
  and (
    public.is_admin()
    or public.has_permanent_educator_room(classroom_id)
  )
)
with check (
  public.has_permission('children', 'edit')
  and daycare_id = public.get_my_daycare_id()
  and (
    public.is_admin()
    or public.has_permanent_educator_room(classroom_id)
  )
);

-- SECURITY DEFINER child-profile RPCs bypass RLS, so enforce the same boundary
-- at the table for authenticated educator writes from every entry point.
create function public.enforce_permanent_child_record_edit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.get_my_role() <> 'educator' then
    return new;
  end if;
  if (tg_op = 'UPDATE' and not public.has_permanent_educator_room(old.classroom_id))
     or not public.has_permanent_educator_room(new.classroom_id) then
    raise exception using
      errcode = '42501',
      message = 'Only an administrator or permanently assigned educator can change a child record.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_permanent_child_record_edit() from public, anon, authenticated;
create trigger enforce_permanent_child_record_edit
before insert or update on public.children
for each row execute function public.enforce_permanent_child_record_edit();
