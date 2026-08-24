-- Group 16 demo data for Sunny Grove. Safe to run repeatedly.
do $$
declare
  v_daycare uuid;
  v_room uuid;
  v_reporter uuid;
  v_witness uuid;
  v_mila uuid;
  v_elise uuid;
begin
  select id into v_daycare
    from daycares
   where name ilike 'Sunny Grove%'
   order by created_at
   limit 1;

  select id into v_room
    from classrooms
   where daycare_id = v_daycare and name ilike 'Infant%'
   order by created_at
   limit 1;

  select id into v_reporter
    from profiles
   where daycare_id = v_daycare
     and role = 'educator'
     and full_name ilike 'Maria Kowalski%'
   limit 1;

  select id into v_witness
    from profiles
   where daycare_id = v_daycare
     and role in ('owner_admin', 'admin', 'educator')
     and id is distinct from v_reporter
     and archived_at is null
   order by case when full_name ilike 'Amara Osei%' then 0 else 1 end, full_name
   limit 1;

  select id into v_mila
    from children
   where daycare_id = v_daycare
     and first_name ilike 'Mila%'
   limit 1;

  select id into v_elise
    from children
   where daycare_id = v_daycare
     and first_name ilike 'Élise%'
   limit 1;

  if v_daycare is null or v_room is null or v_reporter is null then
    raise notice 'Sunny Grove incident seed skipped: daycare, room, or reporter missing';
    return;
  end if;

  if v_mila is not null then
    insert into incident_reports (
      id, daycare_id, child_id, educator_id, classroom_id, occurred_at,
      location, severity, injury_type, injury_side, body_parts, description,
      first_aid_given, first_aid_by, witnesses, witness_id, notes, status
    ) values (
      '53000000-0000-4000-8000-000000000001',
      v_daycare, v_mila, v_reporter, v_room, now() - interval '28 minutes',
      'Block corner', 'minor', 'Fall', 'front', array['Knee'],
      'Lost balance while stepping over a foam block and landed on both knees.',
      'Comforted and checked for redness.', v_reporter, array[]::text[], null,
      'Draft started during indoor play.', 'draft'
    )
    on conflict (id) do update set
      child_id = excluded.child_id,
      educator_id = excluded.educator_id,
      classroom_id = excluded.classroom_id,
      occurred_at = excluded.occurred_at,
      status = 'draft',
      updated_at = now();
  end if;

  if v_elise is not null and v_witness is not null then
    insert into incident_reports (
      id, daycare_id, child_id, educator_id, classroom_id, occurred_at,
      location, severity, injury_type, injury_side, body_parts, description,
      first_aid_given, first_aid_by, witnesses, witness_id, notes, status,
      submitted_at
    ) values (
      '53000000-0000-4000-8000-000000000002',
      v_daycare, v_elise, v_reporter, v_room, now() - interval '75 minutes',
      'Play area', 'moderate', 'Bump / bruise', 'front', array['Forehead'],
      'Bumped her forehead on the low shelf while reaching for a toy.',
      'Cold pack applied for five minutes; comforted and monitored.',
      v_reporter, array[(select full_name from profiles where id = v_witness)],
      v_witness, 'No swelling observed after monitoring.', 'submitted',
      now() - interval '72 minutes'
    )
    on conflict (id) do update set
      child_id = excluded.child_id,
      educator_id = excluded.educator_id,
      classroom_id = excluded.classroom_id,
      occurred_at = excluded.occurred_at,
      witness_id = excluded.witness_id,
      witnesses = excluded.witnesses,
      status = 'submitted',
      submitted_at = excluded.submitted_at,
      signed_off_by = null,
      signed_off_at = null,
      parent_notified_at = null,
      parent_acknowledged_at = null,
      parent_acknowledge_name = null,
      updated_at = now();
  end if;
end
$$;
