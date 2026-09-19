-- Group 2j offer release hardening. Declined, expired and withdrawn offers
-- feed the same durable, administrator-reviewed room-capacity queue used by
-- completed transitions. No family is contacted from a stale client preview.

alter table public.room_vacancy_reviews
  alter column source_transition_plan_id drop not null;

alter table public.room_vacancy_reviews
  add column if not exists source_enrollment_id uuid
    references public.enrollments(id) on delete restrict,
  add column if not exists source_offer_sent_at timestamptz,
  add column if not exists release_reason text;

alter table public.room_vacancy_reviews
  drop constraint if exists room_vacancy_reviews_one_source_check;
alter table public.room_vacancy_reviews
  add constraint room_vacancy_reviews_one_source_check check (
    (source_transition_plan_id is not null and source_enrollment_id is null)
    or (source_transition_plan_id is null and source_enrollment_id is not null)
  );

create unique index if not exists room_vacancy_reviews_offer_release_key
  on public.room_vacancy_reviews (source_enrollment_id, source_offer_sent_at)
  where source_enrollment_id is not null;

create or replace function public.capture_closed_offer_vacancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
  v_available_on date;
begin
  if old.offer_status in ('sent', 'viewed', 'accepted')
     and new.offer_status in ('declined', 'expired', 'withdrawn')
     and new.classroom_id is not null
     and coalesce((
       select settings.auto_offer
         from public.enrollment_settings settings
        where settings.daycare_id = new.daycare_id
     ), true) then
    select (now() at time zone coalesce(center.timezone, 'UTC'))::date
      into v_today
      from public.daycares center
     where center.id = new.daycare_id;

    v_available_on := public._next_center_open_on_or_after(
      new.daycare_id,
      greatest(coalesce(v_today, current_date), coalesce(old.desired_start_date, v_today, current_date))
    );

    insert into public.room_vacancy_reviews (
      daycare_id,
      classroom_id,
      source_enrollment_id,
      source_offer_sent_at,
      release_reason,
      available_on
    ) values (
      new.daycare_id,
      new.classroom_id,
      new.id,
      coalesce(old.offer_sent_at, old.stage_changed_at, old.updated_at, now()),
      new.offer_status,
      coalesce(v_available_on, greatest(coalesce(v_today, current_date), coalesce(old.desired_start_date, v_today, current_date)))
    )
    on conflict (source_enrollment_id, source_offer_sent_at)
      where source_enrollment_id is not null
      do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.capture_closed_offer_vacancy()
  from public, anon, authenticated, service_role;

drop trigger if exists enrollment_offer_release_vacancy on public.enrollments;
create trigger enrollment_offer_release_vacancy
  after update of offer_status on public.enrollments
  for each row execute function public.capture_closed_offer_vacancy();

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
       and enrollment.id is distinct from review.source_enrollment_id
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
         case
           when transition.id is not null
             then moved.first_name || ' ' || moved.last_name || '''s completed move'
           else coalesce(released.child_first_name, 'Family') || '''s '
             || coalesce(vacancy.release_reason, 'closed') || ' offer'
         end,
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
              and waiting.id is distinct from vacancy.source_enrollment_id
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
                and waiting.id is distinct from vacancy.source_enrollment_id
                and waiting.child_id is null
                and waiting.stage not in ('enrolled', 'withdrawn')
           ) then 'No active waitlist family matches this room yet.'
           when not exists (
             select 1 from public.enrollments waiting
              where waiting.daycare_id = vacancy.daycare_id
                and waiting.classroom_id = vacancy.classroom_id
                and waiting.waitlist_status = 'active'
                and waiting.id is distinct from vacancy.source_enrollment_id
                and waiting.child_id is null
                and waiting.stage not in ('enrolled', 'withdrawn')
                and waiting.guardian_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
           ) then 'A matching waitlist family needs a valid guardian email.'
           when exists (
             select 1 from public.enrollments waiting
              where waiting.daycare_id = vacancy.daycare_id
                and waiting.classroom_id = vacancy.classroom_id
                and waiting.waitlist_status = 'active'
                and waiting.id is distinct from vacancy.source_enrollment_id
                and waiting.child_id is null
                and waiting.stage not in ('enrolled', 'withdrawn')
                and waiting.child_date_of_birth is null
           ) then 'A matching waitlist family needs a birth date for the age-fit check.'
           else 'No family currently passes the room age, start-date and capacity checks.'
         end
    from public.room_vacancy_reviews vacancy
    join public.classrooms room on room.id = vacancy.classroom_id
    left join public.room_transition_plans transition
      on transition.id = vacancy.source_transition_plan_id
    left join public.children moved on moved.id = transition.child_id
    left join public.enrollments released on released.id = vacancy.source_enrollment_id
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

create or replace function public.withdraw_enrollment_offer(
  p_enrollment_id uuid,
  p_keep_on_waitlist boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_enrollment public.enrollments%rowtype;
  v_review_id uuid;
  v_now timestamptz := now();
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit') then
    raise exception 'Administrator enrollment-edit permission required';
  end if;
  if v_center_id is null then raise exception 'No center on your profile'; end if;
  if p_enrollment_id is null then raise exception 'Choose an open offer'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Choose a withdrawal reason'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));

  select * into v_enrollment
    from public.enrollments enrollment
   where enrollment.id = p_enrollment_id
     and enrollment.daycare_id = v_center_id
   for update;
  if v_enrollment.id is null then raise exception 'Enrollment offer not found'; end if;

  if v_enrollment.offer_status = 'withdrawn' then
    select vacancy.id into v_review_id
      from public.room_vacancy_reviews vacancy
     where vacancy.source_enrollment_id = v_enrollment.id
       and vacancy.source_offer_sent_at = coalesce(
         v_enrollment.offer_sent_at,
         v_enrollment.stage_changed_at,
         v_enrollment.updated_at
       )
     order by vacancy.created_at desc
     limit 1;
    return jsonb_build_object('status', 'withdrawn', 'review_id', v_review_id, 'retry', true);
  end if;

  if v_enrollment.stage <> 'offer'
     or v_enrollment.offer_status not in ('sent', 'viewed', 'accepted') then
    raise exception 'This offer is no longer open';
  end if;

  update public.enrollments
     set offer_status = 'withdrawn',
         stage = case when p_keep_on_waitlist then 'inquiry' else 'withdrawn' end,
         stage_changed_at = v_now,
         waitlist_status = case when p_keep_on_waitlist then 'active' else 'archived' end,
         waitlist_priority = case when p_keep_on_waitlist then 'public' else waitlist_priority end,
         waitlist_joined_at = case when p_keep_on_waitlist then v_now else waitlist_joined_at end,
         waitlist_position = case when p_keep_on_waitlist then waitlist_position else null end,
         closed_reason = btrim(p_reason),
         closed_at = case when p_keep_on_waitlist then null else v_now end
   where id = v_enrollment.id;

  perform public.reindex_center_waitlist(v_center_id);

  perform public.enqueue_email_notification(
    v_center_id,
    v_enrollment.guardian_email,
    'offer_withdrawn',
    'Update about ' || coalesce(v_enrollment.child_first_name, 'your') || ' enrollment offer',
    'Your enrollment offer has been closed. Your family record remains safely on file.',
    jsonb_build_object(
      'route', '/enrollment',
      'type', 'offer_withdrawn',
      'enrollmentId', v_enrollment.id,
      'keptOnWaitlist', p_keep_on_waitlist
    ),
    'offer-withdrawn:' || v_enrollment.id || ':'
      || coalesce(to_char(v_enrollment.offer_sent_at, 'YYYYMMDDHH24MISS'), 'unsent')
  );

  select vacancy.id into v_review_id
    from public.room_vacancy_reviews vacancy
   where vacancy.source_enrollment_id = v_enrollment.id
     and vacancy.source_offer_sent_at = coalesce(
       v_enrollment.offer_sent_at,
       v_enrollment.stage_changed_at,
       v_enrollment.updated_at
     )
   order by vacancy.created_at desc
   limit 1;

  return jsonb_build_object(
    'status', 'withdrawn',
    'review_id', v_review_id,
    'retry', false
  );
end;
$$;

revoke all on function public.withdraw_enrollment_offer(uuid, boolean, text)
  from public, anon;
grant execute on function public.withdraw_enrollment_offer(uuid, boolean, text)
  to authenticated;

notify pgrst, 'reload schema';
