-- Group 7e -> Group 2b handoff: completing a room transition releases the
-- source-room spot into a durable, reviewed waitlist-offer workflow.
--
-- The completion itself never silently contacts a family. Enrollment shows
-- the next eligible family and an administrator confirms the terms. The final
-- confirmation rechecks ranking, age fit and projected capacity atomically.

create table public.room_vacancy_reviews (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete restrict,
  source_transition_plan_id uuid not null
    references public.room_transition_plans(id) on delete restrict,
  available_on date not null,
  status text not null default 'pending'
    check (status in ('pending', 'offer_sent', 'dismissed')),
  enrollment_id uuid references public.enrollments(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  offer_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_transition_plan_id)
);

create index room_vacancy_reviews_pending_idx
  on public.room_vacancy_reviews (daycare_id, classroom_id, available_on, created_at)
  where status = 'pending';

alter table public.room_vacancy_reviews enable row level security;

revoke all on public.room_vacancy_reviews from public, anon, authenticated;
grant select on public.room_vacancy_reviews to authenticated;

create policy "permitted staff read room vacancy reviews"
  on public.room_vacancy_reviews for select to authenticated
  using (
    daycare_id = public.get_my_daycare_id()
    and public.is_admin()
    and public.has_permission('enrollment', 'view')
  );

create trigger room_vacancy_reviews_updated_at
  before update on public.room_vacancy_reviews
  for each row execute function public.update_updated_at();

create trigger audit_room_vacancy_reviews
  after insert or update on public.room_vacancy_reviews
  for each row execute function public.audit_write();

create or replace function public.capture_completed_transition_vacancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select (now() at time zone coalesce(center.timezone, 'UTC'))::date
      into v_today
      from public.daycares center
     where center.id = new.daycare_id;

    insert into public.room_vacancy_reviews (
      daycare_id,
      classroom_id,
      source_transition_plan_id,
      available_on
    ) values (
      new.daycare_id,
      new.from_classroom_id,
      new.id,
      greatest(new.move_on, coalesce(v_today, current_date))
    )
    on conflict (source_transition_plan_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.capture_completed_transition_vacancy()
  from public, anon, authenticated, service_role;

drop trigger if exists room_transition_plan_vacancy
  on public.room_transition_plans;
create trigger room_transition_plan_vacancy
  after update of status on public.room_transition_plans
  for each row execute function public.capture_completed_transition_vacancy();

-- Private projection used by both the review preview and the final offer.
-- It mirrors transition planning: future starts, active offer holds,
-- departures and scheduled room moves all affect the dated room occupancy.
create or replace function public._enrollment_room_projected_occupancy(
  p_room_id uuid,
  p_on_date date
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with room as (
    select classroom.daycare_id
      from public.classrooms classroom
     where classroom.id = p_room_id
  ), occupants as (
    select coalesce(move.to_classroom_id, child.classroom_id) as effective_room_id
      from public.children child
      join room on room.daycare_id = child.daycare_id
      left join public.room_transition_plans move
        on move.child_id = child.id
       and move.status = 'planned'
       and move.from_classroom_id = child.classroom_id
       and move.move_on <= p_on_date
     where child.archived_at is null
       and coalesce(child.enrolled_on, '-infinity'::date) <= p_on_date
       and not exists (
         select 1
           from public.child_departures departure
          where departure.child_id = child.id
            and departure.status in ('scheduled', 'completed')
            and departure.last_day < p_on_date
       )
  ), offer_holds as (
    select count(*)::integer as held
      from public.enrollments enrollment
      join room on room.daycare_id = enrollment.daycare_id
     where enrollment.classroom_id = p_room_id
       and enrollment.child_id is null
       and coalesce(enrollment.desired_start_date, '-infinity'::date) <= p_on_date
       and (
         enrollment.stage = 'enrolled'
         or (
           enrollment.stage = 'offer'
           and (
             enrollment.offer_status = 'accepted'
             or (
               enrollment.offer_status in ('sent', 'viewed')
               and (
                 enrollment.offer_expires_at is null
                 or enrollment.offer_expires_at > now()
               )
             )
           )
         )
       )
  )
  select (
    select count(*)::integer
      from occupants
     where effective_room_id = p_room_id
  ) + coalesce((select held from offer_holds), 0)
$$;

revoke all on function public._enrollment_room_projected_occupancy(uuid, date)
  from public, anon, authenticated, service_role;

create or replace function public._next_center_open_on_or_after(
  p_daycare_id uuid,
  p_date date
)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select candidate.day::date
    from generate_series(p_date, p_date + 366, interval '1 day') candidate(day)
   where extract(isodow from candidate.day) between 1 and 5
     and not exists (
       select 1
         from public.center_closures closure
        where closure.daycare_id = p_daycare_id
          and candidate.day::date between closure.starts_on and closure.ends_on
     )
   order by candidate.day
   limit 1
$$;

revoke all on function public._next_center_open_on_or_after(uuid, date)
  from public, anon, authenticated, service_role;

create or replace function public._room_vacancy_offer_candidate(p_review_id uuid)
returns table (
  enrollment_id uuid,
  guardian_name text,
  guardian_email text,
  child_first_name text,
  child_last_name text,
  child_date_of_birth date,
  desired_start_date date,
  offer_start_on date,
  waitlist_position integer,
  waitlist_priority text,
  offer_tuition_cents integer,
  offer_deposit_cents integer,
  age_months integer,
  projected_children integer
)
language sql
stable
security definer
set search_path = public
as $$
  with review as (
    select vacancy.*
      from public.room_vacancy_reviews vacancy
     where vacancy.id = p_review_id
       and vacancy.status = 'pending'
  ), room as (
    select classroom.*, review.available_on
      from review
      join public.classrooms classroom on classroom.id = review.classroom_id
     where classroom.archived_at is null
       and classroom.capacity is not null
       and classroom.capacity > 0
       and classroom.min_age_months is not null
       and classroom.max_age_months is not null
  ), settings as (
    select coalesce(configuration.siblings_first, true) as siblings_first,
           coalesce(configuration.staff_children_next, true) as staff_children_next
      from review
      left join public.enrollment_settings configuration
        on configuration.daycare_id = review.daycare_id
  ), dated as (
    select enrollment.*,
           public._next_center_open_on_or_after(
             room.daycare_id,
             greatest(
               room.available_on,
               coalesce(enrollment.desired_start_date, room.available_on),
               coalesce(room.opens_on, room.available_on)
             )
           ) as computed_start_on,
           room.capacity,
           room.min_age_months,
           room.max_age_months,
           room.available_on,
           settings.siblings_first,
           settings.staff_children_next
      from review
      join room on true
      join settings on true
      join public.enrollments enrollment
        on enrollment.daycare_id = review.daycare_id
       and enrollment.classroom_id = review.classroom_id
       and enrollment.waitlist_status = 'active'
       and enrollment.child_id is null
       and enrollment.stage not in ('enrolled', 'withdrawn')
     where enrollment.guardian_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       and enrollment.child_date_of_birth is not null
  ), eligible as (
    select dated.*,
           public._enrollment_room_projected_occupancy(
             dated.classroom_id,
             dated.computed_start_on
           ) as occupancy
      from dated
     where dated.computed_start_on is not null
       and dated.computed_start_on <= dated.available_on + 365
       and dated.computed_start_on >= (
         dated.child_date_of_birth + make_interval(months => dated.min_age_months)
       )::date
       and dated.computed_start_on < (
         dated.child_date_of_birth + make_interval(months => dated.max_age_months)
       )::date
  )
  select eligible.id,
         eligible.guardian_name,
         eligible.guardian_email,
         eligible.child_first_name,
         eligible.child_last_name,
         eligible.child_date_of_birth,
         eligible.desired_start_date,
         eligible.computed_start_on,
         eligible.waitlist_position,
         eligible.waitlist_priority,
         eligible.offer_tuition_cents,
         eligible.offer_deposit_cents,
         (
           extract(year from age(eligible.computed_start_on, eligible.child_date_of_birth)) * 12
           + extract(month from age(eligible.computed_start_on, eligible.child_date_of_birth))
         )::integer,
         eligible.occupancy
    from eligible
   where eligible.occupancy < eligible.capacity
   order by
     case
       when eligible.waitlist_priority = 'sibling' and eligible.siblings_first then 0
       when eligible.waitlist_priority = 'staff' and eligible.staff_children_next
         then case when eligible.siblings_first then 1 else 0 end
       else 2
     end,
     eligible.waitlist_position nulls last,
     eligible.waitlist_joined_at nulls last,
     eligible.created_at,
     eligible.id
   limit 1
$$;

revoke all on function public._room_vacancy_offer_candidate(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_room_vacancy_reviews()
returns table (
  id uuid,
  daycare_id uuid,
  classroom_id uuid,
  room_name text,
  available_on date,
  source_transition_plan_id uuid,
  moved_child_name text,
  updated_at timestamptz,
  candidate_enrollment_id uuid,
  candidate_guardian_name text,
  candidate_guardian_email text,
  candidate_child_first_name text,
  candidate_child_last_name text,
  candidate_child_date_of_birth date,
  candidate_desired_start_date date,
  candidate_offer_start_on date,
  candidate_waitlist_position integer,
  candidate_waitlist_priority text,
  candidate_offer_tuition_cents integer,
  candidate_offer_deposit_cents integer,
  candidate_age_months integer,
  projected_children integer,
  capacity integer,
  active_waitlist_count bigint,
  blocking_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'view') then
    raise exception 'Administrator enrollment-view permission required';
  end if;

  return query
  select vacancy.id,
         vacancy.daycare_id,
         vacancy.classroom_id,
         room.name,
         vacancy.available_on,
         vacancy.source_transition_plan_id,
         moved.first_name || ' ' || moved.last_name,
         vacancy.updated_at,
         candidate.enrollment_id,
         candidate.guardian_name,
         candidate.guardian_email,
         candidate.child_first_name,
         candidate.child_last_name,
         candidate.child_date_of_birth,
         candidate.desired_start_date,
         candidate.offer_start_on,
         candidate.waitlist_position,
         candidate.waitlist_priority,
         candidate.offer_tuition_cents,
         candidate.offer_deposit_cents,
         candidate.age_months,
         candidate.projected_children,
         room.capacity,
         (
           select count(*)
             from public.enrollments waiting
            where waiting.daycare_id = vacancy.daycare_id
              and waiting.classroom_id = vacancy.classroom_id
              and waiting.waitlist_status = 'active'
              and waiting.child_id is null
              and waiting.stage not in ('enrolled', 'withdrawn')
         ),
         case
           when room.archived_at is not null then 'The source room is archived.'
           when room.capacity is null or room.capacity < 1 then 'Set the room capacity before offering this spot.'
           when room.min_age_months is null or room.max_age_months is null then 'Set the room age band before matching a family.'
           when candidate.enrollment_id is not null then null
           when not exists (
             select 1 from public.enrollments waiting
              where waiting.daycare_id = vacancy.daycare_id
                and waiting.classroom_id = vacancy.classroom_id
                and waiting.waitlist_status = 'active'
                and waiting.child_id is null
                and waiting.stage not in ('enrolled', 'withdrawn')
           ) then 'No active waitlist family matches this room yet.'
           when not exists (
             select 1 from public.enrollments waiting
              where waiting.daycare_id = vacancy.daycare_id
                and waiting.classroom_id = vacancy.classroom_id
                and waiting.waitlist_status = 'active'
                and waiting.child_id is null
                and waiting.stage not in ('enrolled', 'withdrawn')
                and waiting.guardian_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
           ) then 'A matching waitlist family needs a valid guardian email.'
           when exists (
             select 1 from public.enrollments waiting
              where waiting.daycare_id = vacancy.daycare_id
                and waiting.classroom_id = vacancy.classroom_id
                and waiting.waitlist_status = 'active'
                and waiting.child_id is null
                and waiting.stage not in ('enrolled', 'withdrawn')
                and waiting.child_date_of_birth is null
           ) then 'A matching waitlist family needs a birth date for the age-fit check.'
           else 'No family currently passes the room age, start-date and capacity checks.'
         end
    from public.room_vacancy_reviews vacancy
    join public.classrooms room on room.id = vacancy.classroom_id
    join public.room_transition_plans transition
      on transition.id = vacancy.source_transition_plan_id
    join public.children moved on moved.id = transition.child_id
    left join lateral public._room_vacancy_offer_candidate(vacancy.id) candidate on true
   where vacancy.daycare_id = public.get_my_daycare_id()
     and vacancy.status = 'pending'
     and not exists (
       select 1
         from public.room_vacancy_reviews earlier
        where earlier.daycare_id = vacancy.daycare_id
          and earlier.classroom_id = vacancy.classroom_id
          and earlier.status = 'pending'
          and (earlier.available_on, earlier.created_at, earlier.id)
              < (vacancy.available_on, vacancy.created_at, vacancy.id)
     )
   order by vacancy.available_on, room.name, vacancy.id;
end;
$$;

revoke all on function public.get_room_vacancy_reviews()
  from public, anon;
grant execute on function public.get_room_vacancy_reviews()
  to authenticated;

-- One atomic offer operation serves the ordinary Group 2 offer modal and the
-- transition-vacancy review. This closes the old read-then-update race.
create or replace function public.send_reviewed_enrollment_offer(
  p_enrollment_id uuid,
  p_classroom_id uuid,
  p_start_on date,
  p_window_hours integer,
  p_tuition_cents integer,
  p_deposit_cents integer,
  p_vacancy_review_id uuid default null,
  p_expected_vacancy_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_review public.room_vacancy_reviews%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_room public.classrooms%rowtype;
  v_candidate record;
  v_projected integer;
  v_now timestamptz := now();
  v_expires_at timestamptz;
  v_center_name text;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit') then
    raise exception 'Administrator enrollment-edit permission required';
  end if;
  if v_center_id is null then raise exception 'No center on your profile'; end if;
  if p_window_hours not between 12 and 336 then
    raise exception 'Offer window must be between 12 hours and 2 weeks';
  end if;
  if p_tuition_cents is null or p_tuition_cents < 0 or p_tuition_cents > 10000000
     or p_deposit_cents is null or p_deposit_cents < 0 or p_deposit_cents > 10000000 then
    raise exception 'Enter valid tuition and deposit amounts';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));

  if p_vacancy_review_id is not null then
    select * into v_review
      from public.room_vacancy_reviews vacancy
     where vacancy.id = p_vacancy_review_id
       and vacancy.daycare_id = v_center_id
     for update;
    if v_review.id is null then raise exception 'Released spot review not found'; end if;

    if v_review.status = 'offer_sent'
       and v_review.enrollment_id = p_enrollment_id then
      select * into v_enrollment from public.enrollments where id = p_enrollment_id;
      return jsonb_build_object(
        'status', 'offer_sent',
        'enrollment_id', v_enrollment.id,
        'offer_expires_at', v_enrollment.offer_expires_at,
        'retry', true
      );
    end if;
    if v_review.status <> 'pending' then
      raise exception 'This released spot has already been reviewed';
    end if;
    if p_expected_vacancy_updated_at is null
       or v_review.updated_at is distinct from p_expected_vacancy_updated_at then
      raise exception 'This released spot changed. Close and reopen it before sending an offer';
    end if;
    if exists (
      select 1
        from public.room_vacancy_reviews earlier
       where earlier.daycare_id = v_review.daycare_id
         and earlier.classroom_id = v_review.classroom_id
         and earlier.status = 'pending'
         and (earlier.available_on, earlier.created_at, earlier.id)
             < (v_review.available_on, v_review.created_at, v_review.id)
    ) then
      raise exception 'Review the earlier released spot for this room first';
    end if;
    if p_classroom_id is distinct from v_review.classroom_id then
      raise exception 'The released spot belongs to a different room';
    end if;
  elsif p_expected_vacancy_updated_at is not null then
    raise exception 'A vacancy version requires its released spot review';
  end if;

  select * into v_room
    from public.classrooms room
   where room.id = p_classroom_id
     and room.daycare_id = v_center_id
   for update;
  if v_room.id is null or v_room.archived_at is not null then
    raise exception 'The selected room is no longer active';
  end if;

  -- Lock every row that contributes to the dated projection. Other reviewed
  -- offers and transition completions share the center advisory lock; the row
  -- locks also protect against direct edits while this confirmation runs.
  perform child.id
    from public.children child
   where child.daycare_id = v_center_id
   order by child.id
   for update;
  perform enrollment.id
    from public.enrollments enrollment
   where enrollment.daycare_id = v_center_id
   order by enrollment.id
   for update;

  select * into v_enrollment
    from public.enrollments enrollment
   where enrollment.id = p_enrollment_id
     and enrollment.daycare_id = v_center_id;
  if v_enrollment.id is null then raise exception 'Enrollment record not found'; end if;

  if v_enrollment.stage = 'offer'
     and v_enrollment.offer_status in ('sent', 'viewed')
     and v_enrollment.classroom_id = p_classroom_id
     and v_enrollment.desired_start_date = p_start_on then
    return jsonb_build_object(
      'status', 'offer_sent',
      'enrollment_id', v_enrollment.id,
      'offer_expires_at', v_enrollment.offer_expires_at,
      'retry', true
    );
  end if;

  if v_enrollment.child_id is not null
     or v_enrollment.stage in ('enrolled', 'withdrawn') then
    raise exception 'This family is no longer eligible for an offer';
  end if;
  if v_enrollment.guardian_email is null
     or v_enrollment.guardian_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Add a valid guardian email before sending the offer';
  end if;
  if p_start_on is null
     or p_start_on < (now() at time zone coalesce(
       (select center.timezone from public.daycares center where center.id = v_center_id),
       'UTC'
     ))::date
     or p_start_on > (now() at time zone coalesce(
       (select center.timezone from public.daycares center where center.id = v_center_id),
       'UTC'
     ))::date + 730 then
    raise exception 'Choose a first day within the next two years';
  end if;
  if extract(isodow from p_start_on) not between 1 and 5
     or exists (
       select 1 from public.center_closures closure
        where closure.daycare_id = v_center_id
          and p_start_on between closure.starts_on and closure.ends_on
     ) then
    raise exception 'Choose a first day when the center is open';
  end if;
  if v_room.opens_on is not null and v_room.opens_on > p_start_on then
    raise exception 'The selected room has not opened by that first day';
  end if;
  if v_room.capacity is null or v_room.capacity < 1 then
    raise exception 'Set the room capacity before sending an offer';
  end if;
  if v_room.min_age_months is null or v_room.max_age_months is null
     or v_enrollment.child_date_of_birth is null then
    raise exception 'Complete the child birth date and room age band before sending an offer';
  end if;
  if p_start_on < (
       v_enrollment.child_date_of_birth
       + make_interval(months => v_room.min_age_months)
     )::date
     or p_start_on >= (
       v_enrollment.child_date_of_birth
       + make_interval(months => v_room.max_age_months)
     )::date then
    raise exception 'The child will be outside this room age band on the first day';
  end if;

  if p_vacancy_review_id is not null then
    select * into v_candidate
      from public._room_vacancy_offer_candidate(v_review.id);
    if v_candidate.enrollment_id is null then
      raise exception 'No waitlist family currently passes every fit check';
    end if;
    if v_candidate.enrollment_id is distinct from p_enrollment_id
       or v_candidate.offer_start_on is distinct from p_start_on then
      raise exception 'The next eligible family changed. Close and reopen this review';
    end if;
    if v_enrollment.waitlist_status <> 'active'
       or v_enrollment.classroom_id <> v_review.classroom_id then
      raise exception 'This family is no longer active on the matching room waitlist';
    end if;
  end if;

  v_projected := public._enrollment_room_projected_occupancy(
    p_classroom_id,
    p_start_on
  );
  if v_projected >= v_room.capacity then
    raise exception 'The room no longer has a safe projected spot on that date';
  end if;

  v_expires_at := v_now + make_interval(hours => p_window_hours);

  update public.enrollments
     set classroom_id = p_classroom_id,
         desired_start_date = p_start_on,
         stage = 'offer',
         stage_changed_at = v_now,
         offer_sent_at = v_now,
         offer_expires_at = v_expires_at,
         offer_viewed_at = null,
         offer_nudged_at = null,
         offer_status = 'sent',
         offer_accepted_at = null,
         offer_declined_at = null,
         offer_decline_reason = null,
         offer_deposit_cents = p_deposit_cents,
         offer_tuition_cents = p_tuition_cents,
         waitlist_status = 'offer',
         parent_workflow_step = 'offer',
         agreement_signed_at = null,
         agreement_data = '{}'::jsonb,
         deposit_status = 'unpaid',
         deposit_paid_at = null,
         deposit_payment_id = null
   where id = v_enrollment.id
   returning * into v_enrollment;

  if p_vacancy_review_id is not null then
    update public.room_vacancy_reviews
       set status = 'offer_sent',
           enrollment_id = v_enrollment.id,
           reviewed_by = auth.uid(),
           offer_sent_at = v_now
     where id = v_review.id;
  end if;

  select center.name into v_center_name
    from public.daycares center
   where center.id = v_center_id;

  perform public.enqueue_email_notification(
    v_center_id,
    v_enrollment.guardian_email,
    'waitlist_offer',
    coalesce(v_enrollment.child_first_name, 'Your family') || ' has a spot at ' || coalesce(v_center_name, 'your center'),
    coalesce(v_enrollment.guardian_name, 'Hello')
      || ', your enrollment offer is held until '
      || to_char(v_expires_at at time zone coalesce(
        (select center.timezone from public.daycares center where center.id = v_center_id),
        'UTC'
      ), 'Mon FMDD, YYYY at FMHH12:MI AM')
      || '. Open it securely in DailyLog: dailylog://offer?code='
      || v_enrollment.offer_code,
    jsonb_build_object(
      'route', '/enrollment',
      'type', 'waitlist_offer',
      'screen', 'ParentEnrollmentOffer',
      'enrollmentId', v_enrollment.id,
      'offerCode', v_enrollment.offer_code,
      'vacancyReviewId', p_vacancy_review_id
    ),
    case
      when p_vacancy_review_id is not null
        then 'room-vacancy-offer:' || p_vacancy_review_id
      else 'reviewed-offer:' || v_enrollment.id || ':' || to_char(v_now, 'YYYYMMDDHH24MI')
    end
  );

  return jsonb_build_object(
    'status', 'offer_sent',
    'enrollment_id', v_enrollment.id,
    'offer_expires_at', v_expires_at,
    'projected_children_before_offer', v_projected,
    'capacity', v_room.capacity,
    'retry', false
  );
end;
$$;

revoke all on function public.send_reviewed_enrollment_offer(
  uuid, uuid, date, integer, integer, integer, uuid, timestamptz
) from public, anon;
grant execute on function public.send_reviewed_enrollment_offer(
  uuid, uuid, date, integer, integer, integer, uuid, timestamptz
) to authenticated;
