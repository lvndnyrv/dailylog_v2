-- Group 2k: adding a family to the waitlist and changing ranking rules must
-- never leave only part of the center-wide order saved. Keep both operations
-- behind guarded, center-scoped transactions and queue family notices from
-- the same commit.

create or replace function public.reindex_center_waitlist(p_daycare_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  with configuration as (
    select coalesce(settings.siblings_first, true) as siblings_first,
           coalesce(settings.staff_children_next, true) as staff_children_next
      from (select 1) seed
      left join public.enrollment_settings settings
        on settings.daycare_id = p_daycare_id
  ), ranked as (
    select enrollment.id,
      row_number() over (
        order by
          case
            when enrollment.waitlist_priority = 'sibling'
              and configuration.siblings_first then 0
            when enrollment.waitlist_priority = 'staff'
              and configuration.staff_children_next
              then case when configuration.siblings_first then 1 else 0 end
            else 2
          end,
          coalesce(enrollment.waitlist_joined_at, enrollment.created_at),
          enrollment.id
      )::integer as next_position
    from public.enrollments enrollment
    cross join configuration
    where enrollment.daycare_id = p_daycare_id
      and enrollment.waitlist_status in ('active', 'offer')
  )
  update public.enrollments enrollment
     set waitlist_position = ranked.next_position
    from ranked
   where enrollment.id = ranked.id
     and enrollment.waitlist_position is distinct from ranked.next_position
$$;

revoke all on function public.reindex_center_waitlist(uuid)
  from public, anon, authenticated;

create or replace function public.add_enrollment_to_waitlist(
  p_enrollment_id uuid,
  p_classroom_id uuid,
  p_desired_start date,
  p_sibling_priority boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_enrollment public.enrollments%rowtype;
  v_room public.classrooms%rowtype;
  v_start date;
  v_age_on_start integer;
  v_position integer;
  v_joined_at timestamptz;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit') then
    raise exception 'Administrator enrollment-edit permission required';
  end if;
  if p_enrollment_id is null or p_classroom_id is null then
    raise exception 'Choose a family and room';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));

  select * into v_enrollment
    from public.enrollments enrollment
   where enrollment.id = p_enrollment_id
     and enrollment.daycare_id = v_center_id
   for update;
  if v_enrollment.id is null then
    raise exception 'Enrollment family not found in this center';
  end if;

  if v_enrollment.waitlist_status = 'active' then
    if v_enrollment.classroom_id <> p_classroom_id then
      raise exception 'This family is already waiting for another room';
    end if;
    perform public.reindex_center_waitlist(v_center_id);
    select waitlist_position into v_position
      from public.enrollments where id = v_enrollment.id;
    return jsonb_build_object(
      'status', 'active', 'retry', true,
      'enrollment_id', v_enrollment.id, 'position', v_position
    );
  end if;
  if v_enrollment.waitlist_status = 'offer'
     or (v_enrollment.offer_status in ('sent', 'viewed', 'accepted')) then
    raise exception 'Close or withdraw the current offer before changing this waitlist entry';
  end if;
  if v_enrollment.stage in ('enrolled', 'withdrawn') or v_enrollment.child_id is not null then
    raise exception 'Only an active pre-enrollment family can join the waitlist';
  end if;
  if nullif(btrim(coalesce(v_enrollment.child_first_name, '')), '') is null then
    raise exception 'Add the child name before joining the waitlist';
  end if;
  if v_enrollment.child_date_of_birth is null then
    raise exception 'Add the child birth date before checking room eligibility';
  end if;
  if v_enrollment.guardian_email is null
     or v_enrollment.guardian_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Add a valid guardian email before joining the waitlist';
  end if;

  select * into v_room
    from public.classrooms classroom
   where classroom.id = p_classroom_id
     and classroom.daycare_id = v_center_id
     and classroom.archived_at is null
   for update;
  if v_room.id is null then
    raise exception 'Choose an active room in this center';
  end if;
  if v_room.min_age_months is null or v_room.max_age_months is null then
    raise exception 'Set the room age band before adding families to its waitlist';
  end if;

  v_start := coalesce(p_desired_start, v_enrollment.desired_start_date);
  if v_start is null then
    raise exception 'Choose the family''s desired start date';
  end if;
  if v_room.opens_on is not null and v_room.opens_on > v_start then
    raise exception '% does not open until %',
      v_room.name, to_char(v_room.opens_on, 'Mon FMDD, YYYY');
  end if;

  v_age_on_start := (
    extract(year from age(greatest(v_start, public.center_today()), v_enrollment.child_date_of_birth)) * 12
    + extract(month from age(greatest(v_start, public.center_today()), v_enrollment.child_date_of_birth))
  )::integer;
  if v_age_on_start < v_room.min_age_months or v_age_on_start >= v_room.max_age_months then
    raise exception '% will be % months old; % accepts %–% months',
      v_enrollment.child_first_name, v_age_on_start, v_room.name,
      v_room.min_age_months, v_room.max_age_months - 1;
  end if;

  v_joined_at := now();
  update public.enrollments
     set classroom_id = v_room.id,
         desired_start_date = v_start,
         waitlist_status = 'active',
         waitlist_priority = case when p_sibling_priority then 'sibling' else 'public' end,
         waitlist_joined_at = v_joined_at,
         waitlist_position = null,
         waitlist_last_contact_at = null,
         waitlist_unanswered_checkins = 0,
         waitlist_response_due_at = null,
         waitlist_last_response_at = null,
         offer_status = 'draft',
         offer_sent_at = null,
         offer_expires_at = null,
         offer_viewed_at = null,
         offer_nudged_at = null
   where id = v_enrollment.id;

  perform public.reindex_center_waitlist(v_center_id);
  select waitlist_position into v_position
    from public.enrollments where id = v_enrollment.id;

  insert into public.notification_outbox (
    daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
  ) values (
    v_center_id,
    lower(v_enrollment.guardian_email),
    'email',
    'waitlist_confirmation',
    coalesce(v_enrollment.child_first_name, 'Your family') || ' is on the waitlist',
    coalesce(v_enrollment.guardian_name, 'Hello')
      || ', your center-wide waitlist position is #' || v_position
      || '. Track your place in DailyLog: dailylog://inquiry?code='
      || upper(v_enrollment.offer_code),
    jsonb_build_object(
      'type', 'waitlist_confirmation',
      'screen', 'ParentInquiryJourney',
      'journeyCode', upper(v_enrollment.offer_code),
      'enrollmentId', v_enrollment.id,
      'position', v_position,
      'classroomId', v_room.id,
      'desiredStart', v_start
    ),
    'waitlist-added:' || v_enrollment.id || ':' || extract(epoch from v_joined_at)::bigint
  ) on conflict do nothing;

  return jsonb_build_object(
    'status', 'active', 'retry', false,
    'enrollment_id', v_enrollment.id,
    'classroom_id', v_room.id,
    'desired_start', v_start,
    'position', v_position
  );
end;
$$;

revoke all on function public.add_enrollment_to_waitlist(uuid, uuid, date, boolean)
  from public, anon;
grant execute on function public.add_enrollment_to_waitlist(uuid, uuid, date, boolean)
  to authenticated;

create or replace function public.update_enrollment_waitlist_rules(
  p_siblings_first boolean,
  p_staff_children_next boolean,
  p_offer_window_hours integer,
  p_auto_offer boolean,
  p_auto_archive_checkins integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_revision text := (extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  v_family record;
  v_moved integer := 0;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit') then
    raise exception 'Administrator enrollment-edit permission required';
  end if;
  if p_siblings_first is null or p_staff_children_next is null
     or p_auto_offer is null then
    raise exception 'Every waitlist rule must have a value';
  end if;
  if p_offer_window_hours is null or p_offer_window_hours < 12
     or p_offer_window_hours > 336 then
    raise exception 'Offer window must be between 12 and 336 hours';
  end if;
  if p_auto_archive_checkins is null or p_auto_archive_checkins < 1
     or p_auto_archive_checkins > 10 then
    raise exception 'Stale-entry threshold must be between 1 and 10 check-ins';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));

  insert into public.enrollment_settings (
    daycare_id, siblings_first, staff_children_next, offer_window_hours,
    auto_offer, auto_archive_checkins
  ) values (
    v_center_id, p_siblings_first, p_staff_children_next,
    p_offer_window_hours, p_auto_offer, p_auto_archive_checkins
  ) on conflict (daycare_id) do update
    set siblings_first = excluded.siblings_first,
        staff_children_next = excluded.staff_children_next,
        offer_window_hours = excluded.offer_window_hours,
        auto_offer = excluded.auto_offer,
        auto_archive_checkins = excluded.auto_archive_checkins;

  for v_family in
    with ranked as (
      select enrollment.id,
        row_number() over (
          order by
            case
              when enrollment.waitlist_priority = 'sibling' and p_siblings_first then 0
              when enrollment.waitlist_priority = 'staff' and p_staff_children_next
                then case when p_siblings_first then 1 else 0 end
              else 2
            end,
            coalesce(enrollment.waitlist_joined_at, enrollment.created_at),
            enrollment.id
        )::integer as next_position
      from public.enrollments enrollment
      where enrollment.daycare_id = v_center_id
        and enrollment.waitlist_status in ('active', 'offer')
    ), moved as (
      update public.enrollments enrollment
         set waitlist_position = ranked.next_position
        from ranked
       where enrollment.id = ranked.id
         and enrollment.waitlist_position is distinct from ranked.next_position
      returning enrollment.id, enrollment.guardian_email,
                enrollment.guardian_name, enrollment.child_first_name,
                enrollment.offer_code, enrollment.waitlist_position
    )
    select * from moved
  loop
    v_moved := v_moved + 1;
    if v_family.guardian_email is not null
       and v_family.guardian_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       and v_family.offer_code is not null then
      insert into public.notification_outbox (
        daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
      ) values (
        v_center_id,
        lower(v_family.guardian_email),
        'email',
        'waitlist_position_changed',
        'Your waitlist position changed',
        coalesce(v_family.guardian_name, 'Hello') || ', '
          || coalesce(v_family.child_first_name, 'your family') || ' is now #'
          || v_family.waitlist_position
          || ' after the center updated its ranking rules.',
        jsonb_build_object(
          'type', 'waitlist_position_changed',
          'screen', 'ParentInquiryJourney',
          'journeyCode', upper(v_family.offer_code),
          'enrollmentId', v_family.id,
          'position', v_family.waitlist_position
        ),
        'waitlist-position:' || v_family.id || ':'
          || v_family.waitlist_position || ':' || v_revision
      ) on conflict do nothing;
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'saved',
    'moved_count', v_moved,
    'offer_window_hours', p_offer_window_hours,
    'auto_archive_checkins', p_auto_archive_checkins
  );
end;
$$;

revoke all on function public.update_enrollment_waitlist_rules(boolean, boolean, integer, boolean, integer)
  from public, anon;
grant execute on function public.update_enrollment_waitlist_rules(boolean, boolean, integer, boolean, integer)
  to authenticated;

notify pgrst, 'reload schema';
