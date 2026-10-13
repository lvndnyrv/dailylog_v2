-- Family links and invitations are durable account access, not temporary care.
-- Child-profile RPCs can bypass RLS, so enforce this at their write tables.
create function public.enforce_permanent_child_family_edit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.get_my_role() <> 'educator' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and not exists (
    select 1 from public.children child
     where child.id = old.child_id
       and public.has_permanent_educator_room(child.classroom_id)
  ) then
    raise exception using
      errcode = '42501',
      message = 'Only an administrator or permanently assigned educator can change family access.';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and not exists (
    select 1 from public.children child
     where child.id = new.child_id
       and public.has_permanent_educator_room(child.classroom_id)
  ) then
    raise exception using
      errcode = '42501',
      message = 'Only an administrator or permanently assigned educator can change family access.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.enforce_permanent_child_family_edit() from public, anon, authenticated;
create trigger enforce_permanent_parent_link_edit
before insert or update or delete on public.parent_children
for each row execute function public.enforce_permanent_child_family_edit();
create trigger enforce_permanent_family_child_edit
before insert or update or delete on public.family_children
for each row execute function public.enforce_permanent_child_family_edit();
create trigger enforce_permanent_family_invite_edit
before insert or update or delete on public.child_invite_codes
for each row execute function public.enforce_permanent_child_family_edit();
