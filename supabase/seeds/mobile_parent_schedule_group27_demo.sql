-- Realistic Parent Mobile Group 27 data for Lucia Castillo and Mateo.
-- Login: lucia.castillo@parent.test / password123

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_preschool constant uuid := '20000000-0000-4000-a000-000000000003';
  v_kindergarten constant uuid := '20000000-0000-4000-a000-000000000004';
  v_first_closure date;
  v_move_on date := current_date + 54;
  v_transition_start date;
begin
  if not exists (
    select 1 from public.parent_children
    where parent_id = v_parent and child_id = v_child
  ) then
    raise notice 'Skipping Group 27 demo: Lucia and Mateo are not seeded';
    return;
  end if;

  -- The second Friday from today keeps the Today banner useful whenever the
  -- resettable fixture is applied.
  v_first_closure := current_date
    + (((5 - extract(dow from current_date)::int + 7) % 7) + 7);
  v_transition_start := date_trunc(
    'week', v_move_on::timestamp - interval '7 days'
  )::date;

  update public.daycares
  set opens_at = time '07:00', closes_at = time '18:00'
  where id = v_daycare;

  insert into public.center_closures (
    id, daycare_id, starts_on, ends_on, reason, family_message,
    family_visible, billing_treatment, reminder_days_before, published_at
  ) values
    (
      '42700000-0000-4000-a000-000000000001', v_daycare,
      v_first_closure, v_first_closure, 'Staff professional development',
      'Our educators are completing a full-day safety and curriculum workshop. The whole center is closed; we will see your family on Monday.',
      true, 'no_charge', 3, now() - interval '2 days'
    ),
    (
      '42700000-0000-4000-a000-000000000002', v_daycare,
      v_first_closure + 17, v_first_closure + 17, 'Civic holiday',
      'Sunny Grove is closed for the civic holiday.',
      true, 'no_charge', 3, now() - interval '1 day'
    ),
    (
      '42700000-0000-4000-a000-000000000003', v_daycare,
      v_first_closure + 68, v_first_closure + 69, 'Fall family break',
      'The center is closed Thursday and Friday for our fall family break.',
      true, 'no_charge', 7, now() - interval '12 hours'
    )
  on conflict (id) do update set
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    reason = excluded.reason,
    family_message = excluded.family_message,
    family_visible = true,
    billing_treatment = excluded.billing_treatment,
    reminder_days_before = excluded.reminder_days_before,
    published_at = excluded.published_at,
    updated_at = now();

  delete from public.room_transition_plans
  where child_id = v_child and status = 'planned'
    and id <> '42710000-0000-4000-a000-000000000001';

  insert into public.room_transition_plans (
    id, daycare_id, child_id, from_classroom_id, to_classroom_id,
    move_on, transition_week, transition_starts_on, transition_ends_on,
    current_tuition_cents, new_tuition_cents, currency,
    family_message, family_visible, published_at, status, notes
  ) values (
    '42710000-0000-4000-a000-000000000001', v_daycare, v_child,
    v_preschool, v_kindergarten, v_move_on, true,
    v_transition_start, v_transition_start + 4,
    132000, 118000, 'CAD',
    'Mateo is ready to move up — he will join the Kindergarten room this fall.',
    true, now() - interval '4 hours', 'planned',
    '[group27-demo] Morning visits with Priya and two familiar friends.'
  )
  on conflict (id) do update set
    from_classroom_id = excluded.from_classroom_id,
    to_classroom_id = excluded.to_classroom_id,
    move_on = excluded.move_on,
    transition_week = excluded.transition_week,
    transition_starts_on = excluded.transition_starts_on,
    transition_ends_on = excluded.transition_ends_on,
    current_tuition_cents = excluded.current_tuition_cents,
    new_tuition_cents = excluded.new_tuition_cents,
    currency = excluded.currency,
    family_message = excluded.family_message,
    family_visible = true,
    published_at = excluded.published_at,
    status = 'planned',
    notes = excluded.notes,
    updated_at = now();

  insert into public.notification_preferences (
    profile_id, daycare_id, kind, in_app, push, email
  ) values (v_parent, v_daycare, 'parent_schedule', true, true, false)
  on conflict (profile_id, kind) do update set
    in_app = true, push = true, email = false, updated_at = now();
end;
$$;
