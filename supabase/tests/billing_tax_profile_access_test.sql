-- Rollback-only test: owner can save, family cannot read, audit never copies
-- the registration identifier. Requires Sunny Grove development seed accounts.
begin;

select set_config('test.tax_admin_id', id::text, true)
from public.profiles where email = 'amara@sunnygrove.test' limit 1;
select set_config('test.tax_parent_id', id::text, true)
from public.profiles where email = 'lucia.castillo@parent.test' limit 1;
select set_config('test.tax_daycare_id', daycare_id::text, true)
from public.profiles where email = 'amara@sunnygrove.test' limit 1;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.tax_admin_id'), true);

insert into public.billing_tax_profiles (
  daycare_id, legal_name, statement_address, registration_label,
  registration_number, signer_name, signer_title
) values (
  current_setting('test.tax_daycare_id')::uuid,
  'Test provider', 'Test address', 'Test ID',
  'TEST-SENSITIVE-DO-NOT-LOG', 'Test signer', 'Director'
)
on conflict (daycare_id) do update set
  legal_name = excluded.legal_name,
  statement_address = excluded.statement_address,
  registration_label = excluded.registration_label,
  registration_number = excluded.registration_number,
  signer_name = excluded.signer_name,
  signer_title = excluded.signer_title;

do $$
begin
  if (select count(*) from public.billing_tax_profiles
      where daycare_id = current_setting('test.tax_daycare_id')::uuid) <> 1 then
    raise exception 'Owner cannot read billing tax profile';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.tax_parent_id'), true);
do $$
begin
  if exists (select 1 from public.billing_tax_profiles
      where daycare_id = current_setting('test.tax_daycare_id')::uuid) then
    raise exception 'Parent can read billing tax profile';
  end if;
end;
$$;

reset role;
do $$
begin
  if exists (
    select 1 from public.audit_log
    where entity_type = 'billing_tax_profiles'
      and daycare_id = current_setting('test.tax_daycare_id')::uuid
      and (coalesce(before::text, '') || coalesce(after::text, ''))
        like '%TEST-SENSITIVE-DO-NOT-LOG%'
  ) then
    raise exception 'Registration identifier leaked into audit log';
  end if;
end;
$$;

rollback;
