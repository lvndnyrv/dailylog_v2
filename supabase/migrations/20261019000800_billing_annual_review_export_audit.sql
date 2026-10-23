-- A private accounting handoff is an access to sensitive family billing evidence.
create or replace function public.record_billing_annual_review_export(
  p_family_id uuid, p_review_year integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_daycare_id uuid;
begin
  if auth.uid() is null or not public.is_admin()
     or not public.has_permission('billing', 'edit') then
    raise exception 'Billing edit access is required';
  end if;
  if p_review_year not between 2000 and 2100 then
    raise exception 'Invalid review year';
  end if;
  select daycare_id into v_daycare_id from public.families where id = p_family_id;
  if v_daycare_id is null or v_daycare_id <> public.get_my_daycare_id() then
    raise exception 'Family not found in your center';
  end if;
  insert into public.audit_log (daycare_id, actor_id, action, entity_type, entity_id, after)
  values (v_daycare_id, auth.uid(), 'export', 'billing_annual_review', p_family_id,
    jsonb_build_object('review_year', p_review_year, 'format', 'csv',
      'audience', 'internal_reconciliation'));
end;
$$;
revoke execute on function public.record_billing_annual_review_export(uuid, integer) from public, anon;
grant execute on function public.record_billing_annual_review_export(uuid, integer) to authenticated;
