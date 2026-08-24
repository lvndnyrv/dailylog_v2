-- Resettable Parent Mobile Group 20 incident history for Lucia and Mateo.
-- Login: lucia.castillo@parent.test / password123

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_room uuid;
  v_reporter uuid;
  v_director uuid;
begin
  if not exists (
    select 1 from public.parent_children
     where parent_id = v_parent and child_id = v_child
  ) then
    raise notice 'Skipping Group 20 incident demo: Lucia and Mateo are not seeded';
    return;
  end if;

  select classroom_id into v_room from public.children where id = v_child;
  select id into v_reporter from public.profiles
   where daycare_id = v_daycare and role = 'educator' and archived_at is null
   order by case when full_name ilike 'Grace Chen%' then 0 else 1 end, full_name limit 1;
  select id into v_director from public.profiles
   where daycare_id = v_daycare and role in ('owner_admin', 'admin') and archived_at is null
   order by case when full_name ilike 'Amara Osei%' then 0 else 1 end, full_name limit 1;
  if v_reporter is null or v_director is null then
    raise notice 'Skipping Group 20 incident demo: reporter or director is missing';
    return;
  end if;

  insert into public.incident_reports (
    id, daycare_id, child_id, educator_id, classroom_id, occurred_at,
    location, severity, injury_type, injury_side, body_parts, description,
    first_aid_given, first_aid_by, witnesses, witness_id, notes, status,
    submitted_at, signed_off_by, signed_off_at, parent_notified_at,
    parent_acknowledged_at, parent_acknowledge_name, parent_acknowledged_by
  ) values
  (
    '52000000-0000-4000-a000-000000000020', v_daycare, v_child, v_reporter,
    v_room, now() - interval '2 hours 15 minutes', 'Playground', 'minor',
    'Bump / scrape', 'front', array['Left knee'],
    'Mateo tripped while running toward the slide and scraped his left knee. He cried briefly and was quickly comforted.',
    'Cleaned with water, applied a bandage, and monitored for 15 minutes.',
    v_reporter, array[(select full_name from public.profiles where id = v_director)],
    v_director, 'No swelling or change in movement observed.', 'signed_off',
    now() - interval '2 hours 10 minutes', v_director, now() - interval '90 minutes',
    now() - interval '90 minutes', null, null, null
  ),
  (
    '52000000-0000-4000-a000-000000000021', v_daycare, v_child, v_reporter,
    v_room, now() - interval '18 days', 'Preschool classroom', 'moderate',
    'Bump / bruise', 'front', array['Forehead'],
    'Mateo stood up beneath the reading shelf and bumped his forehead.',
    'Cold pack applied for ten minutes. He returned to quiet play and remained comfortable.',
    v_reporter, array[(select full_name from public.profiles where id = v_director)],
    v_director, 'Family was called before pickup.', 'acknowledged',
    now() - interval '18 days', v_director, now() - interval '18 days' + interval '20 minutes',
    now() - interval '18 days' + interval '20 minutes',
    now() - interval '18 days' + interval '3 hours', 'Lucia Castillo', v_parent
  )
  on conflict (id) do update set
    occurred_at = excluded.occurred_at,
    location = excluded.location,
    severity = excluded.severity,
    injury_type = excluded.injury_type,
    body_parts = excluded.body_parts,
    description = excluded.description,
    first_aid_given = excluded.first_aid_given,
    notes = excluded.notes,
    status = excluded.status,
    submitted_at = excluded.submitted_at,
    signed_off_by = excluded.signed_off_by,
    signed_off_at = excluded.signed_off_at,
    parent_notified_at = excluded.parent_notified_at,
    parent_acknowledged_at = excluded.parent_acknowledged_at,
    parent_acknowledge_name = excluded.parent_acknowledge_name,
    parent_acknowledged_by = excluded.parent_acknowledged_by,
    updated_at = now();

  insert into public.incident_acknowledgments (
    id, daycare_id, incident_id, child_id, parent_id, signed_name,
    statement_version, statement_text, acknowledged_at
  ) values (
    '52100000-0000-4000-a000-000000000021', v_daycare,
    '52000000-0000-4000-a000-000000000021', v_child, v_parent,
    'Lucia Castillo', 'parent-incident-v1',
    'I confirm that I was informed of this incident and reviewed the report provided by the childcare center.',
    now() - interval '18 days' + interval '3 hours'
  ) on conflict (incident_id) do update set
    parent_id = excluded.parent_id,
    signed_name = excluded.signed_name,
    statement_version = excluded.statement_version,
    statement_text = excluded.statement_text,
    acknowledged_at = excluded.acknowledged_at;
end;
$$;
