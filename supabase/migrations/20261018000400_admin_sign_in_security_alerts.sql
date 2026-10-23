-- Auth creates a session on sign-in. Emit a security notice from that trusted
-- event, not from a browser callback that may never complete. This reports a
-- new sign-in, not an inferred "new device" (we have no device fingerprint).
create function public.notify_admin_auth_session()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare uuid;
  v_push boolean := false;
  v_email boolean := false;
  v_payload jsonb;
  v_title text := 'New sign-in to your admin account';
  v_body text := 'If this was not you, review your active sessions and secure your account.';
begin
  select p.daycare_id into v_daycare
    from public.profiles p
   where p.id = new.user_id
     and p.role in ('owner_admin', 'admin')
     and p.archived_at is null;
  if v_daycare is null then return new; end if;

  v_payload := jsonb_build_object(
    'category', 'sessions',
    'source', 'Security',
    'session_id', new.id,
    'href', '/settings?account=sessions&session=' || new.id::text,
    'action_label', 'Review sign-in'
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    v_daycare, new.user_id, 'new_device_sign_in', v_title, v_body, v_payload
  );

  select pref.push, pref.email into v_push, v_email
    from public.notification_preferences pref
   where pref.profile_id = new.user_id
     and pref.daycare_id = v_daycare
     and pref.kind = 'new_device_sign_in';

  -- External delivery is optional and must never break a sign-in or its
  -- in-app notice. The outbox's existing worker applies delivery settings.
  begin
    if coalesce(v_push, false) then
      insert into public.notification_outbox (
        daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
      ) values (
        v_daycare, new.user_id, 'push', 'new_device_sign_in',
        v_title, v_body, v_payload, 'admin-sign-in:' || new.id::text
      ) on conflict do nothing;
    end if;
    if coalesce(v_email, false) then
      insert into public.notification_outbox (
        daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
      ) values (
        v_daycare, new.user_id, 'email', 'new_device_sign_in',
        v_title, v_body, v_payload, 'admin-sign-in:' || new.id::text
      ) on conflict do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
exception when others then
  -- Notification failures must never prevent authentication.
  return new;
end;
$$;

create trigger notify_admin_auth_session
after insert on auth.sessions
for each row execute function public.notify_admin_auth_session();

revoke all on function public.notify_admin_auth_session() from public, anon, authenticated;
