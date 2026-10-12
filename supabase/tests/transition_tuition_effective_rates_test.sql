-- Effective-dated tuition handoff from room transitions; all fixtures roll back.
begin;

create function pg_temp.impersonate(p_role text, p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  center uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  parent_id uuid := gen_random_uuid();
  source uuid;
  target uuid;
  candidate uuid;
  cancel_candidate uuid;
  old_rate uuid;
  plan_id uuid;
  cancel_plan uuid;
  plan_version timestamptz;
  cancel_version timestamptz;
  historical_invoice uuid;
  move_day date;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  move_day := public.next_center_open_date(center, public.center_today() - 1);
  if move_day <> public.center_today() then
    raise notice 'SKIP: effective tuition transition requires an actual open center day';
    return;
  end if;

  insert into public.classrooms(
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (
    center, 'Rollback rate source', 0, 120, 10, 10
  ) returning id into source;
  insert into public.classrooms(
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (
    center, 'Rollback rate destination', 36, 72, 10, 10
  ) returning id into target;
  insert into public.children(
    daycare_id, classroom_id, first_name, last_name, date_of_birth
  ) values (
    center, source, 'Rate', 'Candidate', public.center_today() - interval '4 years'
  ) returning id into candidate;
  insert into public.children(
    daycare_id, classroom_id, first_name, last_name, date_of_birth
  ) values (
    center, source, 'Rate', 'Cancelled', public.center_today() - interval '4 years'
  ) returning id into cancel_candidate;

  insert into public.child_tuition_rates(
    daycare_id, child_id, classroom_id, amount_cents, effective_from, status
  ) values (
    center, candidate, source, 128000, move_day - 100, 'effective'
  ) returning id into old_rate;
  insert into public.invoices(
    daycare_id, child_id, status, issued_on, due_on, subtotal_cents, total_cents
  ) values (
    center, candidate, 'open', move_day - 10, move_day - 1, 128000, 128000
  ) returning id into historical_invoice;
  insert into public.invoice_lines(
    daycare_id, invoice_id, description, quantity, unit_amount_cents, amount_cents
  ) values (
    center, historical_invoice, 'Historical tuition', 1, 128000, 128000
  );

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'rate-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Rate Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;
  insert into public.parent_children(parent_id, child_id, relationship, is_primary)
    values(parent_id, candidate, 'Parent', true);

  perform pg_temp.impersonate('authenticated', owner_id);
  plan_id := public.save_room_transition_plan(jsonb_build_object(
    'child_id', candidate,
    'from_room_id', source,
    'to_room_id', target,
    'move_on', move_day,
    'transition_week', false,
    'current_tuition_cents', 128000,
    'new_tuition_cents', 105000
  ));
  if not exists (
    select 1 from public.child_tuition_rates
    where source_transition_plan_id = plan_id
      and status = 'scheduled'
      and amount_cents = 105000
      and effective_from = move_day
  ) then
    raise exception 'FAIL: transition did not create its scheduled rate';
  end if;
  if (select amount_cents from public.invoice_lines where invoice_id = historical_invoice limit 1) <> 128000 then
    raise exception 'FAIL: scheduling rewrote a historical invoice';
  end if;

  select updated_at into plan_version from public.room_transition_plans where id = plan_id;
  perform public.complete_reviewed_room_transition(plan_id, plan_version);
  if not exists (
    select 1 from public.child_tuition_rates
    where source_transition_plan_id = plan_id
      and status = 'effective'
      and effective_from = move_day
      and effective_to is null
  ) then
    raise exception 'FAIL: completed move did not activate the new rate';
  end if;
  if not exists (
    select 1 from public.child_tuition_rates
    where id = old_rate and effective_to = move_day - 1
  ) then
    raise exception 'FAIL: prior effective rate was not closed cleanly';
  end if;
  if (select total_cents from public.invoices where id = historical_invoice) <> 128000
    or (select amount_cents from public.invoice_lines where invoice_id = historical_invoice limit 1) <> 128000 then
    raise exception 'FAIL: completion rewrote a historical invoice';
  end if;

  perform pg_temp.impersonate('authenticated', parent_id);
  if not exists (
    select 1 from public.child_tuition_rates
    where child_id = candidate and status = 'effective' and amount_cents = 105000
  ) then
    raise exception 'FAIL: linked parent cannot read the effective rate';
  end if;

  perform pg_temp.impersonate('authenticated', owner_id);
  cancel_plan := public.save_room_transition_plan(jsonb_build_object(
    'child_id', cancel_candidate,
    'from_room_id', source,
    'to_room_id', target,
    'move_on', move_day,
    'transition_week', false,
    'new_tuition_cents', 99000
  ));
  select updated_at into cancel_version from public.room_transition_plans where id = cancel_plan;
  perform public.cancel_room_transition_plan(cancel_plan, cancel_version);
  if not exists (
    select 1 from public.child_tuition_rates
    where source_transition_plan_id = cancel_plan and status = 'cancelled'
  ) then
    raise exception 'FAIL: cancelled room move left an active scheduled rate';
  end if;
end;
$$;

rollback;
select 'PASS: scheduled transition rates, completion activation, prior-rate closure, cancellation, parent visibility, and immutable historical invoices; rolled back' as result;
