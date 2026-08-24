-- Parent Mobile Group 21 completion: parents can add and retire test payment
-- methods through validated, family-scoped RPCs. Raw card/bank details are
-- never stored; production methods must still be tokenized by a provider.

create or replace function public.add_demo_parent_payment_method(
  p_method_type text,
  p_brand text,
  p_last4 text,
  p_expiry_month int,
  p_expiry_year int,
  p_make_default boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family public.families%rowtype;
  v_method public.family_payment_methods%rowtype;
  v_active_count int;
begin
  if auth.uid() is null then raise exception 'Sign in to manage billing'; end if;

  select family.* into v_family
  from public.family_members member
  join public.families family on family.id = member.family_id
  where member.profile_id = auth.uid()
    and member.receives_billing
    and family.archived_at is null
  order by (member.role = 'primary') desc, member.created_at
  limit 1;

  if v_family.id is null then raise exception 'No family billing account is linked'; end if;
  if p_method_type not in ('card', 'bank') then raise exception 'Choose card or bank account'; end if;
  if length(trim(coalesce(p_brand, ''))) not between 2 and 32 then raise exception 'Enter a valid payment method name'; end if;
  if coalesce(p_last4, '') !~ '^[0-9]{4}$' then raise exception 'Enter the final four digits'; end if;

  if p_method_type = 'card' then
    if p_expiry_month is null or p_expiry_month not between 1 and 12
       or p_expiry_year is null or p_expiry_year not between extract(year from current_date)::int and 2200 then
      raise exception 'Enter a valid card expiry date';
    end if;
    if (make_date(p_expiry_year, p_expiry_month, 1) + interval '1 month')::date <= current_date then
      raise exception 'This card has expired';
    end if;
  end if;

  select count(*) into v_active_count
  from public.family_payment_methods method
  where method.family_id = v_family.id and method.status = 'active';
  if v_active_count >= 6 then raise exception 'Remove a payment method before adding another'; end if;

  insert into public.family_payment_methods (
    daycare_id, family_id, method_type, brand, last4, expiry_month,
    expiry_year, provider, provider_payment_method_ref, status
  ) values (
    v_family.daycare_id, v_family.id, p_method_type, trim(p_brand), p_last4,
    case when p_method_type = 'card' then p_expiry_month else null end,
    case when p_method_type = 'card' then p_expiry_year else null end,
    'demo', 'demo_parent_' || replace(gen_random_uuid()::text, '-', ''), 'active'
  ) returning * into v_method;

  if coalesce(p_make_default, false)
     or not exists (
       select 1 from public.family_billing_preferences preference
       where preference.family_id = v_family.id
         and preference.default_payment_method_id is not null
     ) then
    insert into public.family_billing_preferences (
      family_id, daycare_id, autopay_enabled, default_payment_method_id, updated_by
    ) values (
      v_family.id, v_family.daycare_id, false, v_method.id, auth.uid()
    ) on conflict (family_id) do update set
      default_payment_method_id = excluded.default_payment_method_id,
      updated_by = auth.uid(),
      updated_at = now();
  end if;

  return jsonb_build_object(
    'id', v_method.id,
    'method_type', v_method.method_type,
    'brand', v_method.brand,
    'last4', v_method.last4,
    'expiry_month', v_method.expiry_month,
    'expiry_year', v_method.expiry_year,
    'provider', v_method.provider,
    'status', v_method.status
  );
end;
$$;

create or replace function public.remove_parent_payment_method(p_payment_method_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family public.families%rowtype;
  v_method public.family_payment_methods%rowtype;
  v_replacement uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to manage billing'; end if;

  select family.* into v_family
  from public.family_members member
  join public.families family on family.id = member.family_id
  where member.profile_id = auth.uid()
    and member.receives_billing
    and family.archived_at is null
  order by (member.role = 'primary') desc, member.created_at
  limit 1;
  if v_family.id is null then raise exception 'No family billing account is linked'; end if;

  select * into v_method
  from public.family_payment_methods method
  where method.id = p_payment_method_id
    and method.family_id = v_family.id
    and method.status = 'active'
  for update;
  if v_method.id is null then raise exception 'Payment method not found'; end if;

  update public.family_payment_methods
  set status = 'removed', updated_at = now()
  where id = v_method.id;

  if exists (
    select 1 from public.family_billing_preferences preference
    where preference.family_id = v_family.id
      and preference.default_payment_method_id = v_method.id
  ) then
    select method.id into v_replacement
    from public.family_payment_methods method
    where method.family_id = v_family.id
      and method.status = 'active'
      and (
        method.method_type = 'bank'
        or (make_date(method.expiry_year, method.expiry_month, 1) + interval '1 month')::date > current_date
      )
    order by method.created_at desc
    limit 1;

    update public.family_billing_preferences
    set default_payment_method_id = v_replacement,
        autopay_enabled = autopay_enabled and v_replacement is not null,
        updated_by = auth.uid(),
        updated_at = now()
    where family_id = v_family.id;
  end if;

  return public.get_parent_billing_home();
end;
$$;

create or replace function public.set_parent_billing_preferences(
  p_autopay_enabled boolean,
  p_payment_method_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family public.families%rowtype;
  v_method public.family_payment_methods%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to manage billing'; end if;
  select family.* into v_family
  from public.family_members member
  join public.families family on family.id = member.family_id
  where member.profile_id = auth.uid()
    and member.receives_billing
    and family.archived_at is null
  order by (member.role = 'primary') desc, member.created_at
  limit 1;
  if v_family.id is null then raise exception 'No family billing account is linked'; end if;

  if p_payment_method_id is not null then
    select * into v_method from public.family_payment_methods
    where id = p_payment_method_id and family_id = v_family.id and status = 'active';
    if v_method.id is null then raise exception 'Payment method not found'; end if;
    if v_method.method_type = 'card'
       and (make_date(v_method.expiry_year, v_method.expiry_month, 1) + interval '1 month')::date <= current_date then
      raise exception 'Choose a card that has not expired';
    end if;
  end if;
  if p_autopay_enabled and v_method.id is null then
    raise exception 'Choose a payment method before enabling autopay';
  end if;

  insert into public.family_billing_preferences (
    family_id, daycare_id, autopay_enabled, default_payment_method_id, updated_by
  ) values (
    v_family.id, v_family.daycare_id, p_autopay_enabled, p_payment_method_id, auth.uid()
  ) on conflict (family_id) do update set
    autopay_enabled = excluded.autopay_enabled,
    default_payment_method_id = excluded.default_payment_method_id,
    updated_by = auth.uid(),
    updated_at = now();

  return public.get_parent_billing_home()->'preferences';
end;
$$;

-- Keep the receipt/email implementation intact behind a validating wrapper.
alter function public.complete_demo_parent_invoice_payment(uuid, uuid)
  rename to complete_demo_parent_invoice_payment_group25;
revoke all on function public.complete_demo_parent_invoice_payment_group25(uuid, uuid) from public, anon, authenticated;

create function public.complete_demo_parent_invoice_payment(
  p_invoice_id uuid,
  p_payment_method_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_method public.family_payment_methods%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to pay an invoice'; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice.id is null or v_invoice.family_id is null
     or not coalesce(public.can_manage_family_billing(v_invoice.family_id), false) then
    raise exception 'Invoice not found';
  end if;
  select * into v_method from public.family_payment_methods
  where id = p_payment_method_id
    and family_id = v_invoice.family_id
    and status = 'active';
  if v_method.id is null then raise exception 'Payment method not found'; end if;
  if v_method.provider <> 'demo' then
    raise exception 'This payment method must be confirmed by the configured payment provider';
  end if;
  if v_method.method_type = 'card'
     and (make_date(v_method.expiry_year, v_method.expiry_month, 1) + interval '1 month')::date <= current_date then
    raise exception 'This card has expired. Choose another payment method';
  end if;
  return public.complete_demo_parent_invoice_payment_group25(p_invoice_id, p_payment_method_id);
end;
$$;

revoke all on function public.add_demo_parent_payment_method(text, text, text, int, int, boolean) from public, anon;
revoke all on function public.remove_parent_payment_method(uuid) from public, anon;
revoke all on function public.set_parent_billing_preferences(boolean, uuid) from public, anon;
revoke all on function public.complete_demo_parent_invoice_payment(uuid, uuid) from public, anon;
grant execute on function public.add_demo_parent_payment_method(text, text, text, int, int, boolean) to authenticated;
grant execute on function public.remove_parent_payment_method(uuid) to authenticated;
grant execute on function public.set_parent_billing_preferences(boolean, uuid) to authenticated;
grant execute on function public.complete_demo_parent_invoice_payment(uuid, uuid) to authenticated;
