-- Admin account sessions: expose only the caller's sessions and audit actual
-- session removal, regardless of whether it came from sign-out or expiry.
create function public.list_my_admin_sessions()
returns table (
  session_id uuid,
  created_at timestamptz,
  last_active_at timestamptz,
  user_agent text,
  ip_address text,
  is_current boolean
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  return query
  select s.id, s.created_at,
         coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at),
         s.user_agent, s.ip::text,
         s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
    from auth.sessions s
   where s.user_id = auth.uid()
     and (s.not_after is null or s.not_after > now())
   order by (s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid) desc,
            coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at) desc
   limit 100;
end;
$$;

revoke all on function public.list_my_admin_sessions() from public, anon;
grant execute on function public.list_my_admin_sessions() to authenticated;

create function public.audit_admin_session_end()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare uuid;
begin
  select p.daycare_id into v_daycare
    from public.profiles p
   where p.id = old.user_id
     and p.role in ('owner_admin', 'admin')
     and p.archived_at is null;

  if v_daycare is not null then
    insert into public.audit_log (
      daycare_id, actor_id, action, entity_type, entity_id, after
    ) values (
      v_daycare, old.user_id, 'session_ended', 'account_security', old.id,
      jsonb_build_object(
        'last_active_at', coalesce(old.refreshed_at at time zone 'UTC', old.updated_at),
        'user_agent', left(coalesce(old.user_agent, ''), 512),
        'ip_address', old.ip::text
      )
    );
  end if;
  return old;
exception when others then
  -- An audit failure must not prevent Auth from ending a session.
  return old;
end;
$$;

create trigger audit_admin_session_end
after delete on auth.sessions
for each row execute function public.audit_admin_session_end();

revoke all on function public.audit_admin_session_end() from public, anon, authenticated;
