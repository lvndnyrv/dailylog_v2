-- The former parent billing payload summed all succeeded family payments in the
-- previous calendar year and called the result a tax receipt. That amount is
-- neither child-specific nor reviewed/published and can omit refunds. Keep the
-- key null until the annual statement publication workflow exists.
create or replace function public.get_parent_billing_home()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_family public.families%rowtype;
  v_profile public.profiles%rowtype;
  v_payload jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to view billing'; end if;

  select * into v_profile from public.profiles where id = auth.uid();
  select f.* into v_family
  from public.family_members fm
  join public.families f on f.id = fm.family_id
  where fm.profile_id = auth.uid()
    and fm.receives_billing
    and f.archived_at is null
  order by (fm.role = 'primary') desc, fm.created_at
  limit 1;

  if v_family.id is null then raise exception 'No family billing account is linked'; end if;

  select jsonb_build_object(
    'family_id', v_family.id,
    'family_name', v_family.display_name,
    'billing_email', coalesce(v_family.billing_email, v_profile.email),
    'daycare_name', (select d.name from public.daycares d where d.id = v_family.daycare_id),
    'current_balance_cents', coalesce((
      select sum(greatest(i.total_cents - coalesce(p.paid_cents, 0), 0))
      from public.invoices i
      left join lateral (
        select sum(amount_cents) as paid_cents from public.payments
        where invoice_id = i.id and status = 'succeeded'
      ) p on true
      where i.family_id = v_family.id and i.status in ('open', 'overdue')
    ), 0),
    'next_due_on', (
      select min(i.due_on) from public.invoices i
      where i.family_id = v_family.id and i.status in ('open', 'overdue')
    ),
    'preferences', coalesce((
      select jsonb_build_object(
        'autopay_enabled', pref.autopay_enabled,
        'default_payment_method_id', pref.default_payment_method_id
      )
      from public.family_billing_preferences pref where pref.family_id = v_family.id
    ), jsonb_build_object('autopay_enabled', false, 'default_payment_method_id', null)),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', method.id,
        'method_type', method.method_type,
        'brand', method.brand,
        'last4', method.last4,
        'expiry_month', method.expiry_month,
        'expiry_year', method.expiry_year,
        'provider', method.provider,
        'status', method.status
      ) order by method.created_at)
      from public.family_payment_methods method
      where method.family_id = v_family.id and method.status = 'active'
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'number', item.number,
        'status', item.status,
        'issued_on', item.issued_on,
        'due_on', item.due_on,
        'total_cents', item.total_cents,
        'paid_cents', item.paid_cents,
        'balance_cents', greatest(item.total_cents - item.paid_cents, 0),
        'currency', item.currency,
        'child_name', item.child_name,
        'classroom_name', item.classroom_name,
        'summary', item.summary
      ) order by item.issued_on desc nulls last, item.created_at desc)
      from (
        select i.id, i.number, i.status, i.issued_on, i.due_on,
          i.total_cents, i.currency, i.created_at,
          coalesce(sum(p.amount_cents) filter (where p.status = 'succeeded'), 0)::int as paid_cents,
          concat_ws(' ', c.first_name, c.last_name) as child_name,
          room.name as classroom_name,
          (select line.description from public.invoice_lines line
            where line.invoice_id = i.id order by line.created_at limit 1) as summary
        from public.invoices i
        left join public.payments p on p.invoice_id = i.id
        left join public.children c on c.id = i.child_id
        left join public.classrooms room on room.id = c.classroom_id
        where i.family_id = v_family.id and i.status <> 'void'
        group by i.id, c.first_name, c.last_name, room.name
      ) item
    ), '[]'::jsonb),
    'statements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'period_start', s.period_start,
        'period_end', s.period_end,
        'total_cents', s.total_cents,
        'storage_path', s.storage_path
      ) order by s.period_start desc)
      from public.statements s where s.family_id = v_family.id
    ), '[]'::jsonb),
    'tax_receipt', null
  ) into v_payload;

  return v_payload;
end;
$$;
