-- Rollback-only check for the private reconciliation export audit boundary.
begin;

select set_config('test.export_admin_id', id::text, true)
  from public.profiles where email = 'amara@sunnygrove.test' limit 1;
select set_config('test.export_parent_id', id::text, true)
  from public.profiles where email = 'lucia.castillo@parent.test' limit 1;
select set_config('test.export_family_id', id::text, true)
  from public.families where display_name ilike '%Castillo%' limit 1;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.export_admin_id'), true);
select public.record_billing_annual_review_export(current_setting('test.export_family_id')::uuid, 2026);

do $$
begin
  if not exists (select 1 from public.audit_log
    where daycare_id = public.get_my_daycare_id()
      and actor_id = auth.uid() and action = 'export'
      and entity_type = 'billing_annual_review'
      and entity_id = current_setting('test.export_family_id')::uuid
      and after->>'review_year' = '2026'
      and after->>'audience' = 'internal_reconciliation') then
    raise exception 'Internal export was not audited';
  end if;
  begin
    perform public.record_billing_annual_review_export(
      current_setting('test.export_family_id')::uuid, 1999);
    raise exception 'Invalid export year was accepted';
  exception when others then
    if sqlerrm = 'Invalid export year was accepted' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.export_parent_id'), true);
do $$
begin
  begin
    perform public.record_billing_annual_review_export(
      current_setting('test.export_family_id')::uuid, 2026);
    raise exception 'Parent could audit an internal billing export';
  exception when others then
    if sqlerrm = 'Parent could audit an internal billing export' then raise; end if;
  end;
end;
$$;

reset role;
rollback;
