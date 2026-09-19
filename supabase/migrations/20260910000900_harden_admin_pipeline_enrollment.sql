-- The legacy admin completion path predated the secure parent-offer flow and
-- could create a child in any room without rechecking acceptance, paperwork,
-- deposit, age or dated capacity. Keep the public signature stable while
-- bringing the operation under the same enrollment invariants.

create or replace function public.enroll_from_pipeline(
  p_enrollment_id uuid,
  p_classroom_id uuid,
  p_last_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_enrollment public.enrollments%rowtype;
  v_room public.classrooms%rowtype;
  v_existing_child public.children%rowtype;
  v_child uuid;
  v_start_on date;
  v_age_months integer;
  v_projected integer;
  v_allergies text[] := '{}'::text[];
  v_last_name text := nullif(btrim(p_last_name), '');
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit')
     or not public.has_permission('children', 'edit') then
    raise exception 'Administrator enrollment and child edit permissions required';
  end if;
  if p_enrollment_id is null or p_classroom_id is null or v_last_name is null then
    raise exception 'Enrollment, child last name and room are required';
  end if;
  if length(v_last_name) > 100 then
    raise exception 'Child last name is too long';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));

  select * into v_enrollment
    from public.enrollments enrollment
   where enrollment.id = p_enrollment_id
     and enrollment.daycare_id = v_center_id
   for update;
  if v_enrollment.id is null then
    raise exception 'Enrollment not found';
  end if;
  if v_enrollment.stage = 'enrolled' and v_enrollment.child_id is not null then
    return v_enrollment.child_id;
  end if;
  if v_enrollment.stage <> 'offer' then
    raise exception 'Only an accepted offer can be completed';
  end if;
  if v_enrollment.offer_status <> 'accepted'
     or v_enrollment.offer_accepted_at is null then
    raise exception 'The family must accept the offer first';
  end if;
  if v_enrollment.application_submitted_at is null
     or v_enrollment.agreement_signed_at is null then
    raise exception 'The application and agreement must be complete first';
  end if;
  if coalesce(v_enrollment.offer_deposit_cents, 0) > 0
     and v_enrollment.deposit_status <> 'paid' then
    raise exception 'Record the required deposit before enrollment';
  end if;
  if v_enrollment.classroom_id is null
     or v_enrollment.classroom_id <> p_classroom_id then
    raise exception 'Complete enrollment in the room the family accepted';
  end if;

  select * into v_room
    from public.classrooms room
   where room.id = p_classroom_id
     and room.daycare_id = v_center_id
     and room.archived_at is null
   for update;
  if v_room.id is null then
    raise exception 'The accepted room is no longer available';
  end if;

  v_start_on := greatest(
    coalesce(v_enrollment.desired_start_date, public.center_today()),
    public.center_today()
  );
  if v_room.opens_on is not null and v_room.opens_on > v_start_on then
    raise exception 'The accepted room does not open by the first day';
  end if;
  if public._next_center_open_on_or_after(v_center_id, v_start_on) is distinct from v_start_on then
    raise exception 'Choose a first day when the center is open';
  end if;
  if v_room.capacity is null or v_room.capacity < 1 then
    raise exception 'Set a positive room capacity before enrollment';
  end if;
  if v_enrollment.child_date_of_birth is null then
    raise exception 'Add the child''s birth date before checking room age fit';
  end if;
  if v_room.min_age_months is null or v_room.max_age_months is null then
    raise exception 'Set the room age band before enrollment';
  end if;
  v_age_months := (
    extract(year from age(v_start_on, v_enrollment.child_date_of_birth)) * 12
    + extract(month from age(v_start_on, v_enrollment.child_date_of_birth))
  )::integer;
  if v_age_months < v_room.min_age_months or v_age_months >= v_room.max_age_months then
    raise exception '% is % months old on the first day; % accepts %–% months',
      coalesce(v_enrollment.child_first_name, 'This child'), v_age_months,
      v_room.name, v_room.min_age_months, v_room.max_age_months - 1;
  end if;

  -- The accepted offer already occupies one projected place. Anything above
  -- capacity means another later change invalidated the original fit check.
  v_projected := public._enrollment_room_projected_occupancy(v_room.id, v_start_on);
  if v_projected > v_room.capacity then
    raise exception '% no longer has capacity on the first day (% of % places)',
      v_room.name, v_projected, v_room.capacity;
  end if;

  if jsonb_typeof(v_enrollment.application_data->'allergies') = 'array' then
    select coalesce(array_agg(value), '{}'::text[]) into v_allergies
      from jsonb_array_elements_text(v_enrollment.application_data->'allergies');
  end if;

  if v_enrollment.child_id is null then
    insert into public.children (
      daycare_id, classroom_id, first_name, last_name, date_of_birth,
      allergies, emergency_contacts, enrolled_on, setup_state
    ) values (
      v_center_id, v_room.id,
      coalesce(nullif(btrim(v_enrollment.child_first_name), ''), 'New'),
      v_last_name,
      v_enrollment.child_date_of_birth,
      v_allergies,
      case
        when nullif(btrim(v_enrollment.application_data->>'emergency_contact_name'), '') is null
          then '[]'::jsonb
        else jsonb_build_array(jsonb_build_object(
          'name', v_enrollment.application_data->>'emergency_contact_name',
          'phone', v_enrollment.application_data->>'emergency_contact_phone'
        ))
      end,
      v_start_on,
      jsonb_build_object('enrollment_documents_pending', true)
    ) returning id into v_child;
  else
    select * into v_existing_child
      from public.children child
     where child.id = v_enrollment.child_id
       and child.daycare_id = v_center_id
     for update;
    if v_existing_child.id is null then
      raise exception 'The linked child profile is unavailable';
    end if;
    if v_existing_child.archived_at is not null then
      raise exception 'Restore this child from Alumni instead';
    end if;
    if v_existing_child.classroom_id <> v_room.id then
      raise exception 'The linked child is active in another room';
    end if;
    v_child := v_existing_child.id;
  end if;

  update public.enrollments
     set child_id = v_child,
         child_last_name = v_last_name,
         stage = 'enrolled',
         offer_status = 'accepted',
         waitlist_status = 'not_waitlisted',
         waitlist_position = null,
         parent_workflow_step = 'enrolled',
         stage_changed_at = now(),
         desired_start_date = v_start_on,
         onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
           || jsonb_build_object(
             'offer_complete', true,
             'room_schedule', v_room.name || ' from ' || v_start_on::text,
             'account_linked', parent_account_linked_at is not null
           )
   where id = v_enrollment.id;

  return v_child;
end;
$$;

revoke all on function public.enroll_from_pipeline(uuid, uuid, text)
  from public, anon;
grant execute on function public.enroll_from_pipeline(uuid, uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
