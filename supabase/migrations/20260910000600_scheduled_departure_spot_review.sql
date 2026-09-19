-- Group 2m operational completion. A due child departure archives the child
-- after the center-local last day and, when requested, creates a reviewed room
-- release instead of silently contacting the waitlist.

alter table public.room_vacancy_reviews
  add column if not exists source_child_departure_id uuid
    references public.child_departures(id) on delete restrict;

alter table public.room_vacancy_reviews
  drop constraint if exists room_vacancy_reviews_one_source_check;
alter table public.room_vacancy_reviews
  add constraint room_vacancy_reviews_one_source_check check (
    num_nonnulls(
      source_transition_plan_id,
      source_enrollment_id,
      source_child_departure_id
    ) = 1
  );

create unique index if not exists room_vacancy_reviews_child_departure_key
  on public.room_vacancy_reviews (source_child_departure_id)
  where source_child_departure_id is not null;

create or replace function public.capture_completed_child_departure_vacancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_available_on date;
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.offer_spot_automatically then
    select child.classroom_id into v_room_id
      from public.children child
     where child.id = new.child_id
       and child.daycare_id = new.daycare_id;

    if v_room_id is not null then
      v_available_on := public._next_center_open_on_or_after(
        new.daycare_id,
        new.last_day + 1
      );

      insert into public.room_vacancy_reviews (
        daycare_id,
        classroom_id,
        source_child_departure_id,
        release_reason,
        available_on
      ) values (
        new.daycare_id,
        v_room_id,
        new.id,
        'completed departure',
        coalesce(v_available_on, new.last_day + 1)
      )
      on conflict (source_child_departure_id)
        where source_child_departure_id is not null
        do nothing;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.capture_completed_child_departure_vacancy()
  from public, anon, authenticated, service_role;

drop trigger if exists child_departure_release_vacancy on public.child_departures;
create trigger child_departure_release_vacancy
  after update of status on public.child_departures
  for each row execute function public.capture_completed_child_departure_vacancy();

create or replace function public.schedule_child_departure(
  p_child_id uuid,
  p_last_day date,
  p_reason text,
  p_notes text,
  p_prepare_spot_review boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_today date;
  v_departure_id uuid;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit') then
    raise exception 'Administrator enrollment-edit permission required';
  end if;
  if v_center_id is null then raise exception 'No center on your profile'; end if;
  if p_child_id is null or p_last_day is null or nullif(btrim(p_reason), '') is null then
    raise exception 'Child, last day and reason are required';
  end if;

  select (now() at time zone coalesce(center.timezone, 'UTC'))::date
    into v_today
    from public.daycares center
   where center.id = v_center_id;
  if p_last_day < v_today then raise exception 'The last day cannot be in the past'; end if;
  if length(btrim(p_reason)) > 160 or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Withdrawal details are too long';
  end if;

  perform child.id
    from public.children child
   where child.id = p_child_id
     and child.daycare_id = v_center_id
     and child.archived_at is null
   for update;
  if not found then raise exception 'Active child not found'; end if;

  select departure.id into v_departure_id
    from public.child_departures departure
   where departure.child_id = p_child_id
     and departure.status = 'scheduled'
   for update;

  if v_departure_id is null then
    insert into public.child_departures (
      daycare_id, child_id, last_day, reason, notes,
      offer_spot_automatically, status, scheduled_by
    ) values (
      v_center_id, p_child_id, p_last_day, btrim(p_reason),
      nullif(btrim(p_notes), ''), p_prepare_spot_review, 'scheduled', auth.uid()
    ) returning id into v_departure_id;
  else
    update public.child_departures
       set last_day = p_last_day,
           reason = btrim(p_reason),
           notes = nullif(btrim(p_notes), ''),
           offer_spot_automatically = p_prepare_spot_review,
           scheduled_by = auth.uid()
     where id = v_departure_id;
  end if;

  return v_departure_id;
end;
$$;

revoke all on function public.schedule_child_departure(uuid, date, text, text, boolean)
  from public, anon;
grant execute on function public.schedule_child_departure(uuid, date, text, text, boolean)
  to authenticated;

create or replace function public.process_due_child_departures()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_worker boolean := auth.role() = 'service_role'
    or (auth.uid() is null and auth.role() is null);
  v_count int;
begin
  if not v_worker and (
    auth.uid() is null
    or not public.is_admin()
    or not public.has_permission('enrollment', 'edit')
  ) then
    raise exception 'Administrator enrollment-edit permission required';
  end if;

  if not v_worker then
    perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));
  end if;

  with due as (
    update public.child_departures departure
       set status = 'completed', completed_at = coalesce(completed_at, now())
      from public.daycares center
     where center.id = departure.daycare_id
       and (v_worker or departure.daycare_id = v_center_id)
       and departure.status = 'scheduled'
       and departure.last_day < (
         now() at time zone coalesce(center.timezone, 'UTC')
       )::date
    returning departure.child_id
  ), archived as (
    update public.children child
       set archived_at = coalesce(child.archived_at, now())
     where child.id in (select due.child_id from due)
    returning child.id
  ), closed_pipeline as (
    update public.enrollments enrollment
       set stage = 'withdrawn',
           stage_changed_at = now(),
           closed_at = coalesce(enrollment.closed_at, now())
     where enrollment.child_id in (select archived.id from archived)
    returning enrollment.id
  )
  select count(*) into v_count from archived;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.process_due_child_departures()
  from public, anon;
grant execute on function public.process_due_child_departures()
  to authenticated, service_role;

-- Extend the existing review result without changing its public row shape.
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
           when released.id is not null
             then coalesce(released.child_first_name, 'Family') || '''s '
               || coalesce(vacancy.release_reason, 'closed') || ' offer'
           else departing.first_name || ' ' || departing.last_name || '''s completed departure'
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
    left join public.child_departures departure
      on departure.id = vacancy.source_child_departure_id
    left join public.children departing on departing.id = departure.child_id
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

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job
   where jobname = 'dailylog-child-departures';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'dailylog-child-departures',
    '10 * * * *',
    'select public.process_due_child_departures();'
  );
end;
$$;

notify pgrst, 'reload schema';
