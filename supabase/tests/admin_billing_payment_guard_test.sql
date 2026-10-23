-- Rollback-only: manual payments cannot overdraw or corrupt an invoice ledger.
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
  v_admin constant uuid := '00000000-0000-4000-a000-000000000001';
  v_daycare uuid;
  v_family uuid;
  v_invoice uuid;
  v_empty_invoice uuid;
  v_failed boolean;
begin
  select daycare_id into v_daycare from public.profiles where id = v_admin;
  select id into v_family from public.families where daycare_id = v_daycare limit 1;
  if v_daycare is null or v_family is null then
    raise exception 'Missing seeded owner or family fixture';
  end if;

  insert into public.invoices
    (daycare_id, family_id, number, status, issued_on, due_on, subtotal_cents, total_cents)
  values
    (v_daycare, v_family, 'TEST-PAY-' || substr(gen_random_uuid()::text, 1, 8),
     'open', current_date, current_date + 7, 1000, 1000)
  returning id into v_invoice;

  perform pg_temp.impersonate('authenticated', v_admin);
  if public.record_invoice_payment(v_invoice, 400, 'etransfer') <> 'open' then
    raise exception 'Partial e-transfer was not recorded';
  end if;

  v_failed := false;
  begin
    perform public.record_invoice_payment(v_invoice, 700, 'cash');
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Overpayment was accepted'; end if;

  v_failed := false;
  begin
    update public.invoices set status = 'void' where id = v_invoice;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Part-paid invoice was voided'; end if;

  if public.record_invoice_payment(v_invoice, 600, 'cash') <> 'paid' then
    raise exception 'Final payment did not settle invoice';
  end if;
  v_failed := false;
  begin
    perform public.record_invoice_payment(v_invoice, 1, 'cash');
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Paid invoice accepted another payment'; end if;

  perform pg_temp.impersonate('service_role');
  insert into public.invoices
    (daycare_id, family_id, number, status, issued_on, due_on, subtotal_cents, total_cents)
  values
    (v_daycare, v_family, 'TEST-VOID-' || substr(gen_random_uuid()::text, 1, 8),
     'open', current_date, current_date + 7, 1000, 1000)
  returning id into v_empty_invoice;
  perform pg_temp.impersonate('authenticated', v_admin);
  update public.invoices set status = 'void' where id = v_empty_invoice;
  if (select status from public.invoices where id = v_empty_invoice) <> 'void' then
    raise exception 'Unpaid invoice could not be voided';
  end if;
end;
$$;

rollback;
select 'PASS: admin billing payment and void guards' as result;
