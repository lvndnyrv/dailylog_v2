-- Parent Mobile Group 21 payment-method lifecycle and expiry guards.
-- Requires the standard parent billing demo seed; all mutations roll back.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', p_role)::text, true);
end;
$$;

do $$
declare
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_invoice constant uuid := '52000000-0000-4000-a000-000000000001';
  v_added jsonb;
  v_home jsonb;
  v_family uuid;
  v_expired uuid;
  v_current_method constant uuid := '51000000-0000-4000-a000-000000000001';
  v_failed boolean;
begin
  perform pg_temp.impersonate('authenticated', v_parent);

  v_failed := false;
  begin
    perform public.add_demo_parent_payment_method('card', 'Visa', '12X4', 12, extract(year from current_date)::int + 2, true);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: invalid final four digits were accepted'; end if;

  v_failed := false;
  begin
    perform public.add_demo_parent_payment_method('card', 'Visa', '1111', 1, extract(year from current_date)::int - 1, true);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: expired card was accepted'; end if;
  raise notice 'PASS: malformed and expired methods are rejected';

  v_added := public.add_demo_parent_payment_method(
    'card', 'Mastercard', '4444', 12, extract(year from current_date)::int + 3, true
  );
  if v_added->>'id' is null or v_added->>'last4' <> '4444' then
    raise exception 'FAIL: valid test method was not added: %', v_added;
  end if;

  perform public.set_parent_billing_preferences(true, (v_added->>'id')::uuid);
  v_home := public.get_parent_billing_home();
  if v_home->'preferences'->>'default_payment_method_id' <> v_added->>'id'
     or not (v_home->'preferences'->>'autopay_enabled')::boolean then
    raise exception 'FAIL: added method could not become the autopay default: %', v_home->'preferences';
  end if;
  raise notice 'PASS: a family can add and select its own validated test method';

  perform public.remove_parent_payment_method((v_added->>'id')::uuid);
  v_home := public.get_parent_billing_home();
  if exists (
    select 1 from jsonb_array_elements(v_home->'payment_methods') method
    where method->>'id' = v_added->>'id'
  ) or v_home->'preferences'->>'default_payment_method_id' = v_added->>'id' then
    raise exception 'FAIL: removed method remained available: %', v_home;
  end if;
  raise notice 'PASS: removal retires the method and safely rotates the default';

  perform pg_temp.impersonate('postgres');
  select member.family_id into v_family
  from public.family_members member
  where member.profile_id = v_parent and member.receives_billing
  limit 1;
  insert into public.family_payment_methods (
    daycare_id, family_id, method_type, brand, last4,
    expiry_month, expiry_year, provider, status
  ) values (
    '10000000-0000-4000-a000-000000000001', v_family, 'card', 'Expired Visa', '0002',
    1, extract(year from current_date)::int - 1, 'demo', 'active'
  ) returning id into v_expired;

  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.complete_demo_parent_invoice_payment(v_invoice, v_expired);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: expired card completed a payment'; end if;

  v_failed := false;
  begin
    perform public.set_parent_billing_preferences(true, v_expired);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: expired card enabled autopay'; end if;
  raise notice 'PASS: expired methods cannot pay invoices or enable autopay';

  perform pg_temp.impersonate('postgres');
  update public.invoices set status = 'void' where id = v_invoice;
  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.complete_demo_parent_invoice_payment(v_invoice, v_current_method);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: a void invoice accepted a payment'; end if;
  raise notice 'PASS: a void invoice cannot enter payment processing';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 21 PAYMENT METHODS TESTS: ALL PASSED' as result;
