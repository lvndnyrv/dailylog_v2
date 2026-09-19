-- Re-enrolling an alumnus restores the roster, enrollment lifecycle and stale
-- planning state in one guarded transaction. The web client no longer performs
-- three independent writes that can leave a partially restored child.

create or replace function public.re_enroll_alumni(
  p_child_id uuid,
  p_classroom_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_child public.children%rowtype;
  v_room public.classrooms%rowtype;
  v_enrollment_id uuid;
  v_today date := public.center_today();
  v_age_months integer;
  v_projected integer;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit')
     or not public.has_permission('children', 'edit') then
    raise exception 'Administrator enrollment and child edit permissions required';
  end if;

  if p_child_id is null or p_classroom_id is null then
    raise exception 'Child and new room are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));

  select * into v_child
    from public.children child
   where child.id = p_child_id
     and child.daycare_id = v_center_id
   for update;
  if v_child.id is null then
    raise exception 'Alumni child not found';
  end if;

  select * into v_room
    from public.classrooms room
   where room.id = p_classroom_id
     and room.daycare_id = v_center_id
     and room.archived_at is null
   for update;
  if v_room.id is null then
    raise exception 'Choose an active room in this center';
  end if;

  if v_child.archived_at is null then
    if v_child.classroom_id = v_room.id and v_child.enrolled_on = v_today then
      select enrollment.id into v_enrollment_id
        from public.enrollments enrollment
       where enrollment.child_id = v_child.id
       order by enrollment.stage_changed_at desc nulls last,
                enrollment.created_at desc nulls last,
                enrollment.id
       limit 1;
      return jsonb_build_object(
        'status', 'enrolled',
        'retry', true,
        'child_id', v_child.id,
        'classroom_id', v_room.id,
        'enrollment_id', v_enrollment_id
      );
    end if;
    raise exception 'This child is already active. Move them through Rooms & ratios instead';
  end if;

  if v_room.capacity is null or v_room.capacity < 1 then
    raise exception 'Set a positive room capacity before re-enrolling';
  end if;
  if v_room.opens_on is not null and v_room.opens_on > v_today then
    raise exception 'This room does not open until %', to_char(v_room.opens_on, 'Mon FMDD, YYYY');
  end if;
  if v_child.date_of_birth is null then
    raise exception 'Add the child''s birth date before checking room age fit';
  end if;
  if v_room.min_age_months is null or v_room.max_age_months is null then
    raise exception 'Set the room age band before re-enrolling';
  end if;

  v_age_months := (
    extract(year from age(v_today, v_child.date_of_birth)) * 12
    + extract(month from age(v_today, v_child.date_of_birth))
  )::integer;
  if v_age_months < v_room.min_age_months or v_age_months >= v_room.max_age_months then
    raise exception '% is % months old; % accepts %–% months',
      v_child.first_name, v_age_months, v_room.name,
      v_room.min_age_months, v_room.max_age_months - 1;
  end if;

  v_projected := public._enrollment_room_projected_occupancy(v_room.id, v_today);
  if v_projected >= v_room.capacity then
    raise exception '% is full (% of % places)', v_room.name, v_projected, v_room.capacity;
  end if;

  -- Old future moves must not become live again when the archived child is
  -- restored. Completed/cancelled history remains untouched.
  update public.room_transition_plans
     set status = 'cancelled'
   where child_id = v_child.id
     and status = 'planned';
  update public.room_transition_wait_requests
     set status = 'cancelled'
   where child_id = v_child.id
     and status = 'waiting';
  update public.child_departures
     set status = 'cancelled'
   where child_id = v_child.id
     and status = 'scheduled';

  update public.children
     set archived_at = null,
         classroom_id = v_room.id,
         enrolled_on = v_today
   where id = v_child.id;

  select enrollment.id into v_enrollment_id
    from public.enrollments enrollment
   where enrollment.child_id = v_child.id
   order by enrollment.stage_changed_at desc nulls last,
            enrollment.created_at desc nulls last,
            enrollment.id
   limit 1
   for update;

  if v_enrollment_id is null then
    insert into public.enrollments (
      daycare_id, child_id, classroom_id, child_first_name, child_last_name,
      child_date_of_birth, stage, stage_changed_at, desired_start_date,
      source, waitlist_status, offer_status
    ) values (
      v_center_id, v_child.id, v_room.id, v_child.first_name, v_child.last_name,
      v_child.date_of_birth, 'enrolled', now(), v_today,
      'alumni_reenrollment', 'not_waitlisted', 'draft'
    ) returning id into v_enrollment_id;
  else
    update public.enrollments
       set classroom_id = v_room.id,
           child_first_name = v_child.first_name,
           child_last_name = v_child.last_name,
           child_date_of_birth = v_child.date_of_birth,
           stage = 'enrolled',
           stage_changed_at = now(),
           desired_start_date = v_today,
           waitlist_status = 'not_waitlisted',
           waitlist_position = null,
           waitlist_joined_at = null,
           waitlist_response_due_at = null,
           closed_reason = null,
           closed_at = null,
           offer_status = 'draft',
           offer_sent_at = null,
           offer_expires_at = null,
           offer_viewed_at = null,
           offer_nudged_at = null
     where id = v_enrollment_id;
  end if;

  return jsonb_build_object(
    'status', 'enrolled',
    'retry', false,
    'child_id', v_child.id,
    'classroom_id', v_room.id,
    'classroom_name', v_room.name,
    'enrollment_id', v_enrollment_id,
    'enrolled_on', v_today
  );
end;
$$;

revoke all on function public.re_enroll_alumni(uuid, uuid)
  from public, anon;
grant execute on function public.re_enroll_alumni(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
