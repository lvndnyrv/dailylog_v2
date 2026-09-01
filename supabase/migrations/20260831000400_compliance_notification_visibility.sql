-- Notification previews respect the same restricted-admin boundary as the pack.
create function public.guard_compliance_due_notification()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public._compliance_profile_access(new.profile_id,new.daycare_id,false) then return null; end if;
  return new;
end $$;
create trigger guard_compliance_due_notification before insert on public.notifications
  for each row when (new.kind='compliance_due') execute function public.guard_compliance_due_notification();
revoke all on function public.guard_compliance_due_notification() from public,anon,authenticated;
