-- Group 10: new centers require admin two-step; auth events are recorded at
-- the source rather than relying on the browser returning from a redirect.
-- Existing centers retain their explicit security policy until changed by an
-- owner; changing the default must not unexpectedly lock out active admins.
alter table public.daycares alter column require_admin_mfa set default true;

create function public.audit_admin_auth_session()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_daycare uuid;
begin
  select profile.daycare_id into v_daycare
    from public.profiles profile
   where profile.id = new.user_id
     and profile.role in ('owner_admin', 'admin')
     and profile.archived_at is null;
  if v_daycare is not null then
    insert into public.audit_log (
      daycare_id, actor_id, action, entity_type, entity_id, after
    ) values (
      v_daycare, new.user_id, 'sign_in', 'account_security', new.id,
      jsonb_build_object('assurance_level', coalesce(new.aal::text, 'aal1'))
    );
  end if;
  return new;
exception when others then
  -- Audit trouble must not prevent an administrator from signing in.
  return new;
end;
$$;

create trigger audit_admin_auth_session
after insert on auth.sessions
for each row execute function public.audit_admin_auth_session();

create function public.audit_admin_password_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_daycare uuid;
begin
  if new.encrypted_password is not distinct from old.encrypted_password then
    return new;
  end if;
  select profile.daycare_id into v_daycare
    from public.profiles profile
   where profile.id = new.id
     and profile.role in ('owner_admin', 'admin')
     and profile.archived_at is null;
  if v_daycare is not null then
    insert into public.audit_log (
      daycare_id, actor_id, action, entity_type, entity_id, after
    ) values (
      v_daycare, new.id, 'password_changed', 'account_security', new.id,
      jsonb_build_object('source', 'auth.users')
    );
  end if;
  return new;
exception when others then
  -- Password recovery must remain possible if the audit sink is unavailable.
  return new;
end;
$$;

create trigger audit_admin_password_change
after update of encrypted_password on auth.users
for each row execute function public.audit_admin_password_change();

revoke all on function public.audit_admin_auth_session() from public, anon, authenticated;
revoke all on function public.audit_admin_password_change() from public, anon, authenticated;
