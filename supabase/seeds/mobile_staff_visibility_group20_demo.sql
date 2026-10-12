-- Realistic Group 20 data for Sunny Grove's Preschool room.
-- Idempotent and safe to rerun in local/shared development environments.

do $$
declare
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_room uuid := '20000000-0000-4000-a000-000000000003';
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_event uuid := '82000000-0000-4000-a000-000000000001';
  v_start timestamptz;
begin
  v_start := (public.center_today() + 12 + time '11:00') at time zone 'America/Toronto';

  insert into public.announcements (
    id, daycare_id, classroom_id, author_id, title, body, pinned,
    rsvp_enabled, event_at, event_ends_at, event_location, created_at, updated_at
  ) values (
    v_event, v_daycare, v_room, v_owner,
    'Spring Family Picnic',
    'Bring a picnic blanket and join the Preschool families for lunch, outdoor games and music. Lunch and snacks are provided.',
    true, true, v_start, v_start + interval '3 hours',
    'Fairy Lake Park · North picnic shelter', now() - interval '2 days', now()
  )
  on conflict (id) do update set
    classroom_id = excluded.classroom_id,
    title = excluded.title,
    body = excluded.body,
    pinned = excluded.pinned,
    rsvp_enabled = excluded.rsvp_enabled,
    event_at = excluded.event_at,
    event_ends_at = excluded.event_ends_at,
    event_location = excluded.event_location,
    updated_at = now();

  insert into public.announcement_rsvps (
    daycare_id, announcement_id, profile_id, child_id, response, guests, updated_at
  ) values
    (v_daycare, v_event, '00000000-0000-4000-a000-000000000023',
     '30000000-0000-4000-a000-000000000013', 'yes', 3, now() - interval '18 hours'),
    (v_daycare, v_event, '00000000-0000-4000-a000-000000000024',
     '30000000-0000-4000-a000-000000000014', 'maybe', 2, now() - interval '10 hours'),
    (v_daycare, v_event, '00000000-0000-4000-a000-000000000025',
     '30000000-0000-4000-a000-000000000015', 'no', 0, now() - interval '7 hours')
  on conflict (announcement_id, profile_id) do update set
    child_id = excluded.child_id,
    response = excluded.response,
    guests = excluded.guests,
    updated_at = excluded.updated_at;

  -- Every row is explicit. A missing row remains “Not set” and is treated as
  -- declined for safety by the photo metadata trigger.
  insert into public.consents (
    daycare_id, child_id, parent_id, kind, version,
    granted, granted_at, revoked_at, updated_at
  ) values
    -- Mateo: all activities allowed.
    (v_daycare, '30000000-0000-4000-a000-000000000013', '00000000-0000-4000-a000-000000000023',
     'Photo & media consent', '1', true, now() - interval '5 months', null, now() - interval '5 months'),
    (v_daycare, '30000000-0000-4000-a000-000000000013', '00000000-0000-4000-a000-000000000023',
     'Sunscreen application', '1', true, now() - interval '5 months', null, now() - interval '5 months'),
    (v_daycare, '30000000-0000-4000-a000-000000000013', '00000000-0000-4000-a000-000000000023',
     'Field-trip permission', '1', true, now() - interval '5 months', null, now() - interval '5 months'),
    (v_daycare, '30000000-0000-4000-a000-000000000013', '00000000-0000-4000-a000-000000000023',
     'Water / splash play', '1', true, now() - interval '5 months', null, now() - interval '5 months'),

    -- Sofia: photos declined, the other activities allowed.
    (v_daycare, '30000000-0000-4000-a000-000000000014', '00000000-0000-4000-a000-000000000024',
     'Photo & media consent', '1', false, null, now() - interval '2 months', now() - interval '2 months'),
    (v_daycare, '30000000-0000-4000-a000-000000000014', '00000000-0000-4000-a000-000000000024',
     'Sunscreen application', '1', true, now() - interval '2 months', null, now() - interval '2 months'),
    (v_daycare, '30000000-0000-4000-a000-000000000014', '00000000-0000-4000-a000-000000000024',
     'Field-trip permission', '1', true, now() - interval '2 months', null, now() - interval '2 months'),
    (v_daycare, '30000000-0000-4000-a000-000000000014', '00000000-0000-4000-a000-000000000024',
     'Water / splash play', '1', true, now() - interval '2 months', null, now() - interval '2 months'),

    -- Rosa: walking trips declined.
    (v_daycare, '30000000-0000-4000-a000-000000000015', '00000000-0000-4000-a000-000000000025',
     'Photo & media consent', '1', true, now() - interval '3 months', null, now() - interval '3 months'),
    (v_daycare, '30000000-0000-4000-a000-000000000015', '00000000-0000-4000-a000-000000000025',
     'Sunscreen application', '1', true, now() - interval '3 months', null, now() - interval '3 months'),
    (v_daycare, '30000000-0000-4000-a000-000000000015', '00000000-0000-4000-a000-000000000025',
     'Field-trip permission', '1', false, null, now() - interval '20 days', now() - interval '20 days'),
    (v_daycare, '30000000-0000-4000-a000-000000000015', '00000000-0000-4000-a000-000000000025',
     'Water / splash play', '1', true, now() - interval '3 months', null, now() - interval '3 months'),

    -- Lena: water play declined.
    (v_daycare, '30000000-0000-4000-a000-000000000016', '00000000-0000-4000-a000-000000000026',
     'Photo & media consent', '1', true, now() - interval '4 months', null, now() - interval '4 months'),
    (v_daycare, '30000000-0000-4000-a000-000000000016', '00000000-0000-4000-a000-000000000026',
     'Sunscreen application', '1', true, now() - interval '4 months', null, now() - interval '4 months'),
    (v_daycare, '30000000-0000-4000-a000-000000000016', '00000000-0000-4000-a000-000000000026',
     'Field-trip permission', '1', true, now() - interval '4 months', null, now() - interval '4 months'),
    (v_daycare, '30000000-0000-4000-a000-000000000016', '00000000-0000-4000-a000-000000000026',
     'Water / splash play', '1', false, null, now() - interval '12 days', now() - interval '12 days'),

    -- Ruth: photos declined and sunscreen has not been answered.
    (v_daycare, '30000000-0000-4000-a000-000000000017', '00000000-0000-4000-a000-000000000027',
     'Photo & media consent', '1', false, null, now() - interval '6 days', now() - interval '6 days'),
    (v_daycare, '30000000-0000-4000-a000-000000000017', '00000000-0000-4000-a000-000000000027',
     'Field-trip permission', '1', true, now() - interval '6 days', null, now() - interval '6 days'),
    (v_daycare, '30000000-0000-4000-a000-000000000017', '00000000-0000-4000-a000-000000000027',
     'Water / splash play', '1', true, now() - interval '6 days', null, now() - interval '6 days'),

    -- Elvin: sunscreen declined.
    (v_daycare, '30000000-0000-4000-a000-000000000018', '00000000-0000-4000-a000-000000000028',
     'Photo & media consent', '1', true, now() - interval '1 month', null, now() - interval '1 month'),
    (v_daycare, '30000000-0000-4000-a000-000000000018', '00000000-0000-4000-a000-000000000028',
     'Sunscreen application', '1', false, null, now() - interval '9 days', now() - interval '9 days'),
    (v_daycare, '30000000-0000-4000-a000-000000000018', '00000000-0000-4000-a000-000000000028',
     'Field-trip permission', '1', true, now() - interval '1 month', null, now() - interval '1 month'),
    (v_daycare, '30000000-0000-4000-a000-000000000018', '00000000-0000-4000-a000-000000000028',
     'Water / splash play', '1', true, now() - interval '1 month', null, now() - interval '1 month')
  on conflict (child_id, kind, version) do update set
    parent_id = excluded.parent_id,
    granted = excluded.granted,
    granted_at = excluded.granted_at,
    revoked_at = excluded.revoked_at,
    updated_at = excluded.updated_at;
end $$;
