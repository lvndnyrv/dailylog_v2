-- =============================================================================
-- Admin Group 10 — auditable MFA enrollment and safe center-wide enforcement.
-- Authentication factors remain owned by Supabase Auth; this migration only
-- controls the center policy and records security events without storing codes
-- or authenticator secrets in the application schema.
-- =============================================================================

create or replace function public.set_admin_mfa_requirement(p_required boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Verify with two-step authentication before changing this security rule';
  end if;

  update public.daycares
  set require_admin_mfa = p_required
  where id = v_daycare_id
    and require_admin_mfa is distinct from p_required;
end;
$$;

revoke all on function public.set_admin_mfa_requirement(boolean) from public, anon;
grant execute on function public.set_admin_mfa_requirement(boolean) to authenticated;

comment on function public.set_admin_mfa_requirement(boolean) is
  'Group 10/11: changes center-wide admin MFA enforcement after an AAL2 step-up.';

create or replace function public.record_account_security_event(
  p_event text,
  p_factor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_event not in (
    'mfa_factor_enrolled',
    'mfa_challenge_completed',
    'mfa_factor_removed'
  ) then
    raise exception 'Unsupported account security event';
  end if;
  if p_event in ('mfa_factor_enrolled', 'mfa_factor_removed')
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'AAL2 verification required';
  end if;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, after
  ) values (
    v_daycare_id,
    auth.uid(),
    p_event,
    'account_security',
    p_factor_id,
    jsonb_build_object('assurance_level', coalesce(auth.jwt() ->> 'aal', 'unknown'))
  );
end;
$$;

revoke all on function public.record_account_security_event(text, uuid) from public, anon;
grant execute on function public.record_account_security_event(text, uuid) to authenticated;

comment on function public.record_account_security_event(text, uuid) is
  'Group 10: writes an allow-listed, secret-free MFA event to the center audit log.';
