-- A signed-in admin may revoke one of their other refresh sessions. The
-- existing auth.sessions delete trigger records the end in the audit log.
create function public.end_my_admin_session(p_session_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_current_session uuid;
  v_deleted integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  v_current_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if v_current_session is null or p_session_id is null or p_session_id = v_current_session then
    raise exception 'Choose another active session';
  end if;

  delete from auth.sessions
   where id = p_session_id and user_id = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

revoke all on function public.end_my_admin_session(uuid) from public, anon;
grant execute on function public.end_my_admin_session(uuid) to authenticated;
