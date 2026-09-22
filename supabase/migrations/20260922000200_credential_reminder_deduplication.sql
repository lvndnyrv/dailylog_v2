-- Group 4b/9f: the outbox was deduplicated, but the matching in-app
-- notification was inserted before that check and could appear repeatedly.

create or replace function public.dedupe_credential_reminder_notification()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_timezone text;
  v_today date;
begin
  if new.kind <> 'credential_reminder' then return new; end if;
  select coalesce(daycare.timezone, 'UTC') into v_timezone
    from public.daycares daycare where daycare.id = new.daycare_id;
  v_today := (now() at time zone coalesce(v_timezone, 'UTC'))::date;
  if exists (
    select 1 from public.notifications existing
     where existing.profile_id = new.profile_id
       and existing.kind = 'credential_reminder'
       and existing.payload ->> 'credentialId' = new.payload ->> 'credentialId'
       and (existing.created_at at time zone coalesce(v_timezone, 'UTC'))::date = v_today
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists dedupe_credential_reminder_notification on public.notifications;
create trigger dedupe_credential_reminder_notification
  before insert on public.notifications
  for each row execute function public.dedupe_credential_reminder_notification();
