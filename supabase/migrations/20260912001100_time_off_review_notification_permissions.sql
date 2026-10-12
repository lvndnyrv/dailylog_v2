-- A time-off review alert must only go to an active profile that can perform
-- the staff approval action. This respects explicit custom-role denials as
-- well as active delegated approval access.

create or replace function public.notify_admins_of_time_off_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_name text;
  v_title text := 'Time-off request needs review';
  v_body text;
  v_payload jsonb;
begin
  if new.status <> 'pending' then return new; end if;

  select coalesce(nullif(profile.full_name, ''), 'An educator')
    into v_staff_name
    from public.staff_members member
    left join public.profiles profile on profile.id = member.profile_id
   where member.id = new.staff_member_id;

  v_staff_name := coalesce(v_staff_name, 'An educator');
  v_body := format(
    '%s requested %s leave for %s to %s.',
    v_staff_name,
    new.kind,
    to_char(new.starts_on, 'Mon FMDD'),
    to_char(new.ends_on, 'Mon FMDD')
  );
  v_payload := jsonb_build_object(
    'type', 'time_off_request',
    'requestId', new.id,
    'staffMemberId', new.staff_member_id,
    'href', '/staff?tab=time-off',
    'source', 'Staff · Time off',
    'action_label', 'Review request'
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  )
  select
    new.daycare_id,
    profile.id,
    'time_off_request',
    v_title,
    v_body,
    v_payload
  from public.profiles profile
  where profile.daycare_id = new.daycare_id
    and public.profile_has_permission(profile.id, 'staff', 'approve')
    and not exists (
      select 1
        from public.notifications notification
       where notification.profile_id = profile.id
         and notification.kind = 'time_off_request'
         and notification.payload ->> 'requestId' = new.id::text
    );

  return new;
end;
$$;

revoke all on function public.notify_admins_of_time_off_request()
  from public, anon, authenticated;

comment on function public.notify_admins_of_time_off_request() is
  'Creates a routable in-app alert only for active center profiles with effective staff approval permission.';

notify pgrst, 'reload schema';
