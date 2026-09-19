-- Group 2f — first-day onboarding handoff.
--
-- Accepted families need to remain visible to administrators while the center
-- prepares their room, cubby and welcome. Educators, operational rosters and
-- attendance only receive the child on the agreed first day.

create or replace function public.can_access_child(p_child_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
      from public.children child
     where child.id = p_child_id
       and (
         (public.is_admin() and child.daycare_id = public.get_my_daycare_id())
         or (
           public.get_my_role() = 'educator'
           and child.daycare_id = public.get_my_daycare_id()
           and coalesce(child.enrolled_on, '-infinity'::date) <= public.center_today()
           and child.classroom_id in (select public.my_classroom_ids())
         )
         or (
           public.get_my_role() = 'parent'
           and child.id in (select public.my_child_ids())
         )
       )
  )
$$;

create or replace function public.can_write_child(p_child_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
      from public.children child
     where child.id = p_child_id
       and (
         (public.is_admin() and child.daycare_id = public.get_my_daycare_id())
         or (
           public.get_my_role() = 'educator'
           and child.daycare_id = public.get_my_daycare_id()
           and coalesce(child.enrolled_on, '-infinity'::date) <= public.center_today()
           and child.classroom_id in (select public.my_classroom_ids())
         )
       )
  )
$$;

create or replace function public.can_access_child_area(
  p_child_id uuid,
  p_area text,
  p_action text default 'view'
)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select case
    when public.get_my_role() = 'parent' then
      p_action = 'view' and p_child_id in (select public.my_child_ids())
    when public.is_admin() then
      public.has_permission(p_area, p_action)
      and exists (
        select 1 from public.children child
         where child.id = p_child_id
           and child.daycare_id = public.get_my_daycare_id()
      )
    when public.get_my_role() = 'educator' then
      public.has_permission(p_area, p_action)
      and exists (
        select 1 from public.children child
         where child.id = p_child_id
           and child.daycare_id = public.get_my_daycare_id()
           and coalesce(child.enrolled_on, '-infinity'::date) <= public.center_today()
           and (
             (p_area = 'children' and p_action = 'view')
             or public.can_access_child(child.id)
           )
      )
    else false
  end
$$;

drop policy if exists "read children by area access" on public.children;
create policy "read children by area access" on public.children
  for select
  using (
    (
      public.is_admin()
      and public.has_permission('children', 'view')
      and daycare_id = public.get_my_daycare_id()
    )
    or (
      public.get_my_role() = 'educator'
      and public.has_permission('children', 'view')
      and daycare_id = public.get_my_daycare_id()
      and coalesce(enrolled_on, '-infinity'::date) <= public.center_today()
    )
    or (
      public.get_my_role() = 'parent'
      and id in (select public.my_child_ids())
    )
  );

create or replace function public.enforce_attendance_enrollment_boundary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrolled_on date;
begin
  select child.enrolled_on
    into v_enrolled_on
    from public.children child
   where child.id = new.child_id;

  if not found then
    raise exception 'Child not found';
  end if;
  if v_enrolled_on is not null and new.date < v_enrolled_on then
    raise exception 'Child attendance cannot be recorded before the enrollment start date';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_attendance_enrollment_boundary
  on public.attendance_records;
create trigger enforce_attendance_enrollment_boundary
  before insert or update of child_id, date on public.attendance_records
  for each row execute function public.enforce_attendance_enrollment_boundary();

create or replace function public.save_enrollment_onboarding(
  p_enrollment_id uuid,
  p_primary_educator_id uuid,
  p_cubby_label text,
  p_send_welcome boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_enrollment public.enrollments%rowtype;
  v_child public.children%rowtype;
  v_room public.classrooms%rowtype;
  v_educator public.profiles%rowtype;
  v_cubby text := nullif(btrim(p_cubby_label), '');
  v_timezone text;
  v_welcome_at timestamptz;
  v_schedule_label text;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit')
     or not public.has_permission('children', 'edit') then
    raise exception 'Administrator enrollment and child edit permissions required';
  end if;
  if p_enrollment_id is null or p_primary_educator_id is null or v_cubby is null then
    raise exception 'Enrollment, primary educator and cubby are required';
  end if;
  if length(v_cubby) > 30 then
    raise exception 'Cubby label must be 30 characters or fewer';
  end if;

  select * into v_enrollment
    from public.enrollments enrollment
   where enrollment.id = p_enrollment_id
     and enrollment.daycare_id = v_center_id
   for update;
  if v_enrollment.id is null then raise exception 'Enrollment not found'; end if;
  if v_enrollment.stage <> 'enrolled'
     or v_enrollment.child_id is null
     or v_enrollment.classroom_id is null
     or v_enrollment.desired_start_date is null then
    raise exception 'Complete enrollment and choose the first day before room setup';
  end if;

  select * into v_child
    from public.children child
   where child.id = v_enrollment.child_id
     and child.daycare_id = v_center_id
     and child.archived_at is null
   for update;
  if v_child.id is null then raise exception 'The enrolled child is unavailable'; end if;
  if v_child.classroom_id <> v_enrollment.classroom_id then
    raise exception 'The child and enrollment room do not match';
  end if;

  select * into v_room
    from public.classrooms room
   where room.id = v_enrollment.classroom_id
     and room.daycare_id = v_center_id
     and room.archived_at is null;
  if v_room.id is null then raise exception 'The enrollment room is unavailable'; end if;

  select * into v_educator
    from public.profiles educator
   where educator.id = p_primary_educator_id
     and educator.daycare_id = v_center_id
     and educator.role = 'educator'
     and educator.archived_at is null
     and (
       educator.classroom_id = v_room.id
       or exists (
         select 1 from public.educator_classrooms assignment
          where assignment.educator_id = educator.id
            and assignment.classroom_id = v_room.id
       )
     );
  if v_educator.id is null then
    raise exception 'Choose an active educator assigned to %', v_room.name;
  end if;

  if exists (
    select 1
      from public.children child
     where child.daycare_id = v_center_id
       and child.classroom_id = v_room.id
       and child.id <> v_child.id
       and child.archived_at is null
       and lower(btrim(coalesce(child.setup_state->>'cubby_label', ''))) = lower(v_cubby)
  ) then
    raise exception 'Cubby % is already assigned in %', v_cubby, v_room.name;
  end if;

  v_schedule_label := case
    when v_enrollment.schedule = '{}'::jsonb then 'Schedule not entered'
    else coalesce(nullif(v_enrollment.schedule->>'label', ''), 'Family schedule saved')
  end;

  update public.children
     set setup_state = coalesce(setup_state, '{}'::jsonb) || jsonb_build_object(
           'primary_educator_id', v_educator.id,
           'primary_educator_name', v_educator.full_name,
           'cubby_label', v_cubby
         ),
         updated_at = now()
   where id = v_child.id;

  update public.enrollments
     set onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb) || jsonb_build_object(
           'room_schedule', jsonb_build_object(
             'room_id', v_room.id,
             'room_name', v_room.name,
             'schedule', v_enrollment.schedule,
             'schedule_label', v_schedule_label,
             'primary_educator_id', v_educator.id,
             'primary_educator_name', v_educator.full_name,
             'cubby_label', v_cubby,
             'configured_at', now()
           ),
           'primary_educator_id', v_educator.id,
           'primary_educator_name', v_educator.full_name,
           'cubby_label', v_cubby
         ),
         updated_at = now()
   where id = v_enrollment.id;

  if coalesce(p_send_welcome, true)
     and v_enrollment.guardian_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    select coalesce(daycare.timezone, 'UTC') into v_timezone
      from public.daycares daycare where daycare.id = v_center_id;
    v_welcome_at := greatest(
      now(),
      ((v_enrollment.desired_start_date - 3) + time '09:00') at time zone v_timezone
    );

    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, body, payload,
      dedupe_key, available_at
    ) values (
      v_center_id,
      lower(btrim(v_enrollment.guardian_email)),
      'email',
      'enrollment_welcome',
      'Welcome to ' || v_room.name,
      format(
        '%s starts on %s. Their primary educator is %s and cubby %s is ready.',
        coalesce(v_enrollment.child_first_name, 'Your child'),
        to_char(v_enrollment.desired_start_date, 'FMMonth FMDD, YYYY'),
        v_educator.full_name,
        v_cubby
      ),
      jsonb_build_object(
        'route', '/today',
        'type', 'enrollment_welcome',
        'enrollmentId', v_enrollment.id,
        'childId', v_child.id
      ),
      'enrollment-welcome:' || v_enrollment.id,
      v_welcome_at
    ) on conflict do nothing;
  end if;

  return jsonb_build_object(
    'enrollment_id', v_enrollment.id,
    'child_id', v_child.id,
    'room_name', v_room.name,
    'primary_educator_name', v_educator.full_name,
    'cubby_label', v_cubby,
    'welcome_scheduled_for', case when p_send_welcome then v_welcome_at else null end
  );
end;
$$;

revoke all on function public.save_enrollment_onboarding(uuid, uuid, text, boolean)
  from public, anon;
grant execute on function public.save_enrollment_onboarding(uuid, uuid, text, boolean)
  to authenticated;

-- The notification permission trigger maps every transactional email to an
-- application area. Welcome messages belong to enrollment, not daily logs.
create or replace function public.enforce_notification_enqueue_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area text;
  v_marker text;
  v_family_id uuid;
  v_payment_id uuid;
  v_enrollment_id uuid;
  v_report_id uuid;
  v_pickup_id uuid;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  if auth.role() = 'anon' and new.kind in ('enrollment_inquiry_received', 'tour_confirmation', 'waitlist_confirmation') then return new; end if;

  if new.kind = 'parent_enrollment_receipt' and new.channel = 'email' and new.recipient_id is null then
    v_marker := current_setting('dailylog.parent_enrollment_payment_id', true);
    begin
      v_payment_id := nullif(new.payload->>'paymentId', '')::uuid;
      v_enrollment_id := nullif(new.payload->>'enrollmentId', '')::uuid;
    exception when invalid_text_representation then v_payment_id := null; v_enrollment_id := null; end;
    if v_marker = v_payment_id::text and exists (
      select 1 from public.enrollment_offer_payments payment
      join public.enrollments enrollment on enrollment.id = payment.enrollment_id and payment.enrollment_id = v_enrollment_id
      where payment.id = v_payment_id and payment.status = 'succeeded'
        and lower(payment.receipt_emailed_to) = lower(new.recipient_email)
        and lower(enrollment.guardian_email) = lower(new.recipient_email)
    ) then return new; end if;
  end if;

  if auth.uid() is not null and new.kind = 'parent_payment_receipt' and new.channel = 'email' and new.recipient_id is null then
    v_marker := current_setting('dailylog.parent_demo_payment_family', true);
    begin
      v_family_id := nullif(new.payload->>'familyId', '')::uuid;
      v_payment_id := nullif(new.payload->>'paymentId', '')::uuid;
    exception when invalid_text_representation then v_family_id := null; v_payment_id := null; end;
    if v_marker = v_family_id::text and coalesce(public.can_manage_family_billing(v_family_id), false)
       and exists (select 1 from public.payments payment where payment.id = v_payment_id and payment.family_id = v_family_id and payment.status = 'succeeded' and lower(payment.receipt_emailed_to) = lower(new.recipient_email))
    then return new; end if;
  end if;

  if auth.uid() is not null and new.kind = 'attendance' and new.channel = 'push' and new.recipient_id is not null
     and new.payload->>'type' in ('attendance_absence', 'attendance_absence_cancelled') then
    v_marker := current_setting('dailylog.parent_absence_report_id', true);
    begin v_report_id := nullif(new.payload->>'reportId', '')::uuid;
    exception when invalid_text_representation then v_report_id := null; end;
    if v_marker = v_report_id::text and exists (
      select 1 from public.parent_absence_reports report
      join public.profiles recipient on recipient.id = new.recipient_id
      join public.children child on child.id = report.child_id
      where report.id = v_report_id and report.reported_by = auth.uid()
        and report.daycare_id = new.daycare_id and report.child_id::text = new.payload->>'childId'
        and recipient.daycare_id = report.daycare_id and recipient.archived_at is null
        and (recipient.role in ('owner_admin', 'admin') or (recipient.role = 'educator' and (recipient.classroom_id = child.classroom_id or exists (select 1 from public.educator_classrooms assignment where assignment.educator_id = recipient.id and assignment.classroom_id = child.classroom_id))))
    ) then return new; end if;
  end if;

  if auth.uid() is not null and new.kind = 'pickup_review' and new.channel = 'push' and new.recipient_id is not null then
    begin v_pickup_id := nullif(new.payload->>'pickupId', '')::uuid;
    exception when invalid_text_representation then v_pickup_id := null; end;
    if exists (
      select 1 from public.child_pickups pickup join public.profiles recipient on recipient.id = new.recipient_id
      where pickup.id = v_pickup_id and pickup.requested_by = auth.uid() and pickup.approval_status = 'pending'
        and pickup.archived_at is null and pickup.daycare_id = new.daycare_id
        and pickup.child_id::text = new.payload->>'childId' and recipient.daycare_id = pickup.daycare_id
        and recipient.role in ('owner_admin', 'admin') and recipient.archived_at is null
    ) then return new; end if;
  end if;

  if new.kind = 'time_off' then
    if not public.has_permission('staff', 'approve') then raise exception 'staff approve permission required'; end if;
    return new;
  end if;

  v_area := case
    when new.kind in (
      'enrollment_inquiry_received', 'tour_confirmation', 'enrollment_application',
      'enrollment_documents', 'waitlist_offer', 'offer_reminder',
      'offer_withdrawn', 'inquiry_closed', 'waitlist_checkin',
      'waitlist_confirmation', 'waitlist_position_changed', 'enrollment_welcome'
    ) then 'enrollment'
    when new.kind = 'announcement' then 'broadcasts'
    when new.kind = 'incident' then 'incidents'
    when new.kind = 'medication' then 'medications'
    when new.kind in ('invoice', 'invoice_reminder', 'payment', 'parent_payment_receipt', 'parent_enrollment_receipt') then 'billing'
    when new.kind in ('staff_invite', 'credential_reminder') then 'staff'
    when new.kind = 'room_activity_nudge' then 'rooms'
    when new.kind in ('parent_invite', 'pickup_review', 'pickup_reviewed') then 'children'
    when new.kind = 'attendance' then 'attendance'
    else 'daily_logs'
  end;
  if not public.has_permission(v_area, 'edit') then raise exception '% edit permission required', v_area; end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
