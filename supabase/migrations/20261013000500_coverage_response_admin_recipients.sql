-- A delegated educator may have rooms/edit for classroom work, but the
-- coverage planner and cancellation RPC still require an administrator role.
-- Do not send that educator the administrator-only response follow-up.
-- This guard covers both the in-app row and its push outbox row, including
-- future producers of the same notification kind.
create function public._coverage_response_admin_recipient_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
begin
  if new.kind <> 'coverage_response' then
    return new;
  end if;

  if tg_table_name = 'notifications' then
    v_recipient := new.profile_id;
  else
    v_recipient := new.recipient_id;
  end if;

  if not exists (
    select 1
      from public.profiles profile
     where profile.id = v_recipient
       and profile.daycare_id = new.daycare_id
       and profile.role in ('owner_admin', 'admin')
       and profile.archived_at is null
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public._coverage_response_admin_recipient_guard()
  from public, anon, authenticated;

create trigger aa_coverage_response_admin_notification
  before insert on public.notifications
  for each row execute function public._coverage_response_admin_recipient_guard();

create trigger aa_coverage_response_admin_outbox
  before insert on public.notification_outbox
  for each row execute function public._coverage_response_admin_recipient_guard();
