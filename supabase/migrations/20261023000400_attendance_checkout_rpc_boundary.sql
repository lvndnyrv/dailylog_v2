-- Staff may edit attendance, but setting or clearing a checkout timestamp must
-- go through a named, audited workflow. A transaction-local marker is set only
-- by the approved RPC wrappers; direct PostgREST table updates cannot set it.
create function public.enforce_attendance_checkout_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role'
     or (auth.uid() is null and auth.role() is null) then return new; end if;
  if new.checked_out_at is distinct from old.checked_out_at
     and current_setting('dailylog.attendance_checkout_rpc', true) is distinct from 'allowed' then
    raise exception 'Use verified pickup or an audited attendance correction to change check-out';
  end if;
  return new;
end;
$$;
create trigger enforce_attendance_checkout_workflow
  before update of checked_out_at on public.attendance_records
  for each row execute function public.enforce_attendance_checkout_workflow();

-- Preserve the existing function bodies and signatures, while making their
-- public entry points the only way to enter the checkout mutation boundary.
alter function public.complete_mobile_pickup(uuid) rename to complete_mobile_pickup_impl;
revoke all on function public.complete_mobile_pickup_impl(uuid) from public, anon, authenticated;
create function public.complete_mobile_pickup(p_pass_id uuid)
returns table (
  child_id uuid, child_name text, presenter_name text,
  relationship text, checked_out_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('dailylog.attendance_checkout_rpc', 'allowed', true);
  return query select * from public.complete_mobile_pickup_impl(p_pass_id);
end;
$$;
revoke all on function public.complete_mobile_pickup(uuid) from public, anon;
grant execute on function public.complete_mobile_pickup(uuid) to authenticated;

alter function public.kiosk_check(uuid,text) rename to kiosk_check_impl;
revoke all on function public.kiosk_check_impl(uuid,text) from public, anon, authenticated;
create function public.kiosk_check(p_child_id uuid, p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare v_result text;
begin
  perform set_config('dailylog.attendance_checkout_rpc', 'allowed', true);
  v_result := public.kiosk_check_impl(p_child_id, p_pin);
  return v_result;
end;
$$;
revoke all on function public.kiosk_check(uuid,text) from public, anon;
grant execute on function public.kiosk_check(uuid,text) to authenticated;

alter function public.redeem_family_attendance_pass(text) rename to redeem_family_attendance_pass_impl;
revoke all on function public.redeem_family_attendance_pass_impl(text) from public, anon, authenticated;
create function public.redeem_family_attendance_pass(p_qr_payload text)
returns table (direction text, child_name text, presenter_name text)
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('dailylog.attendance_checkout_rpc', 'allowed', true);
  return query select * from public.redeem_family_attendance_pass_impl(p_qr_payload);
end;
$$;
revoke all on function public.redeem_family_attendance_pass(text) from public, anon;
grant execute on function public.redeem_family_attendance_pass(text) to authenticated;

alter function public.correct_attendance_record(uuid,timestamptz,timestamptz,text,text)
  rename to correct_attendance_record_impl;
revoke all on function public.correct_attendance_record_impl(uuid,timestamptz,timestamptz,text,text)
  from public, anon, authenticated;
create function public.correct_attendance_record(
  p_attendance_id uuid, p_checked_in_at timestamptz, p_checked_out_at timestamptz,
  p_source text, p_reason text
)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform set_config('dailylog.attendance_checkout_rpc', 'allowed', true);
  return public.correct_attendance_record_impl(
    p_attendance_id, p_checked_in_at, p_checked_out_at, p_source, p_reason
  );
end;
$$;
revoke all on function public.correct_attendance_record(uuid,timestamptz,timestamptz,text,text)
  from public, anon;
grant execute on function public.correct_attendance_record(uuid,timestamptz,timestamptz,text,text)
  to authenticated;

notify pgrst, 'reload schema';
