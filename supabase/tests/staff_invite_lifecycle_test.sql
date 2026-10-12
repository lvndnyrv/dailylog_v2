-- Rollback-safe Group 4d invitation lifecycle and role-boundary checks.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_invite_id uuid;
  v_old_code text;
  v_new_code text;
  v_result jsonb;
begin
  perform pg_temp.impersonate('authenticated', v_owner);
  v_old_code := public.invite_staff(
    'codex.invite.lifecycle@sunnygrove.test',
    'educator',
    null,
    'Codex Invite Lifecycle',
    'Educator',
    true
  );
  select invite.id into v_invite_id
    from public.staff_invites invite
   where invite.code = v_old_code;
  if v_invite_id is null then
    raise exception 'FAIL: invitation fixture was not created';
  end if;

  v_result := public.resend_staff_invite(v_invite_id);
  v_new_code := v_result ->> 'code';
  if nullif(v_new_code, '') is null or v_new_code = v_old_code then
    raise exception 'FAIL: resend did not rotate the bearer code';
  end if;
  if coalesce((v_result ->> 'resendCount')::integer, 0) <> 1 then
    raise exception 'FAIL: resend count was not incremented';
  end if;
  if exists (select 1 from public.get_staff_invite(v_old_code)) then
    raise exception 'FAIL: previous invitation code remained usable';
  end if;
  if not exists (select 1 from public.get_staff_invite(v_new_code)) then
    raise exception 'FAIL: renewed invitation could not be previewed';
  end if;

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.audit_log audit
     where audit.entity_type = 'staff_invites'
       and audit.entity_id = v_invite_id
       and audit.action = 'resent'
       and not coalesce(audit.after ? 'code', false)
       and not coalesce(audit.before ? 'code', false)
  ) then
    raise exception 'FAIL: redacted resend audit event is missing';
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  begin
    perform public.resend_staff_invite(v_invite_id);
    raise exception 'FAIL: educator resent a staff invitation';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('authenticated', v_owner);
  delete from public.staff_invites where id = v_invite_id;
  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.audit_log audit
     where audit.entity_type = 'staff_invites'
       and audit.entity_id = v_invite_id
       and audit.action = 'cancelled'
       and not coalesce(audit.before ? 'code', false)
  ) then
    raise exception 'FAIL: redacted cancellation audit event is missing';
  end if;
end $$;

rollback;
select 'PASS: staff invites can be inspected, securely resent, audited and cancelled' as result;
