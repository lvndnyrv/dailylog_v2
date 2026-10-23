-- Read-only regression guard: an unreviewed family-wide payment total must not
-- be returned as a tax receipt. Uses the development seed parent account.
do $$
declare
  v_parent uuid;
  v_payload jsonb;
begin
  select id into v_parent
  from public.profiles
  where email = 'lucia.castillo@parent.test'
  limit 1;
  if v_parent is null then
    raise exception 'Seed parent missing';
  end if;

  perform set_config('request.jwt.claim.sub', v_parent::text, true);
  v_payload := public.get_parent_billing_home();
  if v_payload->'tax_receipt' is distinct from 'null'::jsonb then
    raise exception 'Unreviewed tax receipt exposed';
  end if;
  if jsonb_typeof(v_payload->'invoices') <> 'array'
     or jsonb_typeof(v_payload->'statements') <> 'array' then
    raise exception 'Existing parent billing lists changed unexpectedly';
  end if;
end;
$$;
