-- ============================================================================
-- Mobile Group 23 — educator roll call, absences and late-pickup closeout
-- ============================================================================

create table if not exists public.mobile_roll_call_sessions (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  attendance_date date not null,
  completed_by uuid not null references public.profiles(id) on delete restrict,
  completed_at timestamptz not null default now(),
  present_count integer not null default 0 check (present_count >= 0),
  absent_count integer not null default 0 check (absent_count >= 0),
  awaited_count integer not null default 0 check (awaited_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (classroom_id, attendance_date)
);

create index if not exists mobile_roll_call_sessions_center_date_idx
  on public.mobile_roll_call_sessions (daycare_id, attendance_date desc);

drop trigger if exists mobile_roll_call_sessions_updated_at
  on public.mobile_roll_call_sessions;
create trigger mobile_roll_call_sessions_updated_at
  before update on public.mobile_roll_call_sessions
  for each row execute function public.update_updated_at();

create table if not exists public.late_pickup_policies (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  effective_from date not null default current_date,
  closing_time time not null default time '18:00',
  grace_minutes integer not null default 5 check (grace_minutes between 0 and 120),
  fee_per_minute_cents integer not null default 100
    check (fee_per_minute_cents between 0 and 10000),
  daily_cap_cents integer not null default 4000
    check (daily_cap_cents between 0 and 100000),
  conversation_after_count integer not null default 3
    check (conversation_after_count between 1 and 20),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (daycare_id, effective_from)
);

create table if not exists public.late_pickup_events (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  attendance_id uuid not null references public.attendance_records(id) on delete cascade,
  policy_id uuid references public.late_pickup_policies(id) on delete set null,
  occurred_on date not null,
  expected_at timestamptz not null,
  picked_up_at timestamptz not null,
  late_minutes integer not null check (late_minutes > 0),
  billable_minutes integer not null default 0 check (billable_minutes >= 0),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  conversation_required boolean not null default false,
  collected_by text not null,
  notes text,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (attendance_id)
);

create index if not exists late_pickup_events_center_month_idx
  on public.late_pickup_events (daycare_id, occurred_on desc);
create index if not exists late_pickup_events_child_date_idx
  on public.late_pickup_events (child_id, occurred_on desc);

alter table public.mobile_roll_call_sessions enable row level security;
alter table public.late_pickup_policies enable row level security;
alter table public.late_pickup_events enable row level security;

drop policy if exists "staff read roll call completion" on public.mobile_roll_call_sessions;
create policy "staff read roll call completion"
  on public.mobile_roll_call_sessions for select
  using (public.is_staff() and daycare_id = public.get_my_daycare_id());

drop policy if exists "staff read late pickup policy" on public.late_pickup_policies;
create policy "staff read late pickup policy"
  on public.late_pickup_policies for select
  using (public.is_staff() and daycare_id = public.get_my_daycare_id());

drop policy if exists "admins manage late pickup policy" on public.late_pickup_policies;
create policy "admins manage late pickup policy"
  on public.late_pickup_policies for all
  using (public.is_admin() and daycare_id = public.get_my_daycare_id())
  with check (public.is_admin() and daycare_id = public.get_my_daycare_id());

drop policy if exists "staff read late pickup events" on public.late_pickup_events;
create policy "staff read late pickup events"
  on public.late_pickup_events for select
  using (public.is_staff() and daycare_id = public.get_my_daycare_id());

drop trigger if exists audit_mobile_roll_call_sessions
  on public.mobile_roll_call_sessions;
create trigger audit_mobile_roll_call_sessions
  after insert or update on public.mobile_roll_call_sessions
  for each row execute function public.audit_write();

drop trigger if exists audit_late_pickup_events on public.late_pickup_events;
create trigger audit_late_pickup_events
  after insert or update on public.late_pickup_events
  for each row execute function public.audit_write();

create or replace function public.get_mobile_roll_call(p_classroom_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_today date := public.center_today();
  v_classroom public.classrooms%rowtype;
  v_session public.mobile_roll_call_sessions%rowtype;
  v_ratio jsonb := '{}'::jsonb;
  v_children jsonb := '[]'::jsonb;
  v_present integer := 0;
  v_absent integer := 0;
  v_awaited integer := 0;
  v_departed integer := 0;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'view') then
    raise exception 'Attendance view permission is required';
  end if;

  select * into v_classroom
    from public.classrooms room
   where room.id = p_classroom_id
     and room.daycare_id = v_daycare_id
     and room.archived_at is null;
  if v_classroom.id is null then raise exception 'Classroom not found'; end if;
  if public.get_my_role() = 'educator'
     and p_classroom_id not in (select public.my_classroom_ids()) then
    raise exception 'This classroom is outside your assignment';
  end if;

  select * into v_session
    from public.mobile_roll_call_sessions session
   where session.classroom_id = p_classroom_id
     and session.attendance_date = v_today;

  select to_jsonb(ratio) into v_ratio
    from public.get_mobile_room_ratios() ratio
   where ratio.id = p_classroom_id;

  with rows as (
    select
      child.id,
      child.first_name,
      child.last_name,
      child.photo_url,
      attendance.id as attendance_id,
      attendance.checked_in_at,
      attendance.checked_out_at,
      attendance.method,
      attendance.status as attendance_status,
      attendance.absence_reason,
      attendance.notes,
      plan.id as pickup_plan_id,
      plan.scheduled_for as expected_pickup_at,
      plan.presenter_name as expected_pickup_name,
      case
        when attendance.checked_in_at is not null and attendance.checked_out_at is null
          then 'present'
        when attendance.checked_out_at is not null then 'departed'
        when attendance.status in ('absent', 'excused') then 'absent'
        when attendance.status = 'late' then 'coming'
        else 'awaited'
      end as roll_status
    from public.children child
    left join public.attendance_records attendance
      on attendance.child_id = child.id and attendance.date = v_today
    left join lateral (
      select pickup.id, pickup.scheduled_for, pickup.presenter_name
        from public.pickup_plans pickup
       where pickup.child_id = child.id
         and pickup.scheduled_on = v_today
         and pickup.status = 'expected'
       order by pickup.created_at desc
       limit 1
    ) plan on true
    where child.classroom_id = p_classroom_id
      and child.daycare_id = v_daycare_id
      and child.archived_at is null
  ), totals as (
    select
      count(*) filter (where roll_status = 'present')::integer as present_count,
      count(*) filter (where roll_status = 'absent')::integer as absent_count,
      count(*) filter (where roll_status in ('awaited', 'coming'))::integer as awaited_count,
      count(*) filter (where roll_status = 'departed')::integer as departed_count
    from rows
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', rows.id,
        'firstName', rows.first_name,
        'lastName', rows.last_name,
        'fullName', rows.first_name || ' ' || rows.last_name,
        'photoUrl', rows.photo_url,
        'attendanceId', rows.attendance_id,
        'rollStatus', rows.roll_status,
        'attendanceStatus', rows.attendance_status,
        'method', rows.method,
        'checkedInAt', rows.checked_in_at,
        'checkedOutAt', rows.checked_out_at,
        'absenceReason', rows.absence_reason,
        'notes', rows.notes,
        'pickupPlanId', rows.pickup_plan_id,
        'expectedPickupAt', rows.expected_pickup_at,
        'expectedPickupName', rows.expected_pickup_name,
        'isLatePickup', rows.roll_status = 'present'
          and rows.expected_pickup_at is not null
          and rows.expected_pickup_at < now()
      ) order by rows.first_name, rows.last_name
    ), '[]'::jsonb),
    totals.present_count, totals.absent_count, totals.awaited_count, totals.departed_count
  into v_children, v_present, v_absent, v_awaited, v_departed
  from rows cross join totals
  group by totals.present_count, totals.absent_count, totals.awaited_count, totals.departed_count;

  return jsonb_build_object(
    'date', v_today,
    'classroom', jsonb_build_object(
      'id', v_classroom.id, 'name', v_classroom.name, 'ageGroup', v_classroom.age_group
    ),
    'summary', jsonb_build_object(
      'present', coalesce(v_present, 0),
      'absent', coalesce(v_absent, 0),
      'awaited', coalesce(v_awaited, 0),
      'departed', coalesce(v_departed, 0)
    ),
    'ratio', coalesce(v_ratio, '{}'::jsonb),
    'completion', case when v_session.id is null then null else jsonb_build_object(
      'id', v_session.id,
      'completedAt', v_session.completed_at,
      'completedBy', v_session.completed_by,
      'present', v_session.present_count,
      'absent', v_session.absent_count,
      'awaited', v_session.awaited_count
    ) end,
    'children', coalesce(v_children, '[]'::jsonb)
  );
end;
$$;

create or replace function public.mobile_roll_call_check_in(p_child_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_today date := public.center_today();
  v_now timestamptz := now();
  v_existing public.attendance_records%rowtype;
  v_result public.attendance_records%rowtype;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'Attendance edit permission is required';
  end if;
  perform public.assert_rate_limit('mobile_roll_call_check_in', 40, 600, p_child_id::text);

  select * into v_existing
    from public.attendance_records attendance
   where attendance.child_id = p_child_id and attendance.date = v_today
   for update;
  if v_existing.checked_out_at is not null then
    raise exception 'This child was already checked out today';
  end if;

  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, checked_in_by,
    checked_out_at, checked_out_by, method, status, absence_reason, notes
  ) values (
    v_daycare_id, p_child_id, v_today, v_now, auth.uid(),
    null, null, 'educator', 'present', null, null
  )
  on conflict (child_id, date) do update set
    checked_in_at = excluded.checked_in_at,
    checked_in_by = excluded.checked_in_by,
    checked_out_at = null,
    checked_out_by = null,
    method = 'educator',
    status = 'present',
    absence_reason = null,
    notes = null
  returning * into v_result;

  return jsonb_build_object(
    'attendanceId', v_result.id,
    'childId', v_result.child_id,
    'status', 'present',
    'checkedInAt', v_result.checked_in_at
  );
end;
$$;

create or replace function public.mobile_mark_child_absent(
  p_child_id uuid,
  p_reason text,
  p_note text default null,
  p_notify_office boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_today date := public.center_today();
  v_reason text := lower(replace(btrim(coalesce(p_reason, '')), ' ', '_'));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_existing public.attendance_records%rowtype;
  v_result public.attendance_records%rowtype;
  v_child_name text;
  v_reason_label text;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'Attendance edit permission is required';
  end if;
  if v_reason not in ('sick', 'vacation', 'appointment', 'family_day', 'other') then
    raise exception 'Choose a valid absence reason';
  end if;
  if length(coalesce(v_note, '')) > 500 then raise exception 'Note is too long'; end if;
  perform public.assert_rate_limit('mobile_mark_child_absent', 30, 600, p_child_id::text);

  select attendance.* into v_existing
    from public.attendance_records attendance
   where attendance.child_id = p_child_id and attendance.date = v_today
   for update;
  if v_existing.checked_in_at is not null and v_existing.checked_out_at is null then
    raise exception 'Check this child out before marking an absence';
  end if;
  if v_existing.checked_out_at is not null then
    raise exception 'Attendance is already complete for this child today';
  end if;

  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, checked_in_by,
    checked_out_at, checked_out_by, method, status, absence_reason, notes
  ) values (
    v_daycare_id, p_child_id, v_today, null, null,
    null, null, 'educator', 'absent', v_reason, v_note
  )
  on conflict (child_id, date) do update set
    checked_in_at = null,
    checked_in_by = null,
    checked_out_at = null,
    checked_out_by = null,
    method = 'educator',
    status = 'absent',
    absence_reason = excluded.absence_reason,
    notes = excluded.notes
  returning * into v_result;

  select child.first_name || ' ' || child.last_name into v_child_name
    from public.children child where child.id = p_child_id;
  v_reason_label := initcap(replace(v_reason, '_', ' '));

  if p_notify_office then
    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    )
    select v_daycare_id, admin.id, 'push', 'attendance',
      v_child_name || ' marked absent',
      v_reason_label || coalesce(' · ' || v_note, ''),
      jsonb_build_object(
        'type', 'attendance_absence', 'screen', 'Attendance',
        'childId', p_child_id, 'attendanceId', v_result.id
      ),
      'attendance-absence:' || v_result.id::text
    from public.profiles admin
    where admin.daycare_id = v_daycare_id
      and admin.role in ('owner_admin', 'admin')
      and admin.archived_at is null
    on conflict do nothing;

    insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
    select v_daycare_id, admin.id, 'attendance',
      v_child_name || ' marked absent',
      v_reason_label || coalesce(' · ' || v_note, ''),
      jsonb_build_object(
        'type', 'attendance_absence', 'screen', 'Attendance',
        'childId', p_child_id, 'attendanceId', v_result.id
      )
    from public.profiles admin
    where admin.daycare_id = v_daycare_id
      and admin.role in ('owner_admin', 'admin')
      and admin.archived_at is null;
  end if;

  return jsonb_build_object(
    'attendanceId', v_result.id,
    'childId', v_result.child_id,
    'status', 'absent',
    'absenceReason', v_result.absence_reason,
    'notifiedOffice', p_notify_office
  );
end;
$$;

create or replace function public.complete_mobile_roll_call(p_classroom_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_today date := public.center_today();
  v_present integer;
  v_absent integer;
  v_awaited integer;
  v_session public.mobile_roll_call_sessions%rowtype;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit') then
    raise exception 'Attendance edit permission is required';
  end if;
  if not exists (
    select 1 from public.classrooms room
     where room.id = p_classroom_id and room.daycare_id = v_daycare_id
       and room.archived_at is null
  ) or (
    public.get_my_role() = 'educator'
    and p_classroom_id not in (select public.my_classroom_ids())
  ) then raise exception 'This classroom is outside your assignment'; end if;

  select
    count(*) filter (where attendance.checked_in_at is not null
      and attendance.checked_out_at is null)::integer,
    count(*) filter (where attendance.status in ('absent', 'excused')
      and attendance.checked_in_at is null)::integer,
    count(*) filter (where attendance.id is null
      or (attendance.checked_in_at is null and attendance.status = 'late'))::integer
  into v_present, v_absent, v_awaited
  from public.children child
  left join public.attendance_records attendance
    on attendance.child_id = child.id and attendance.date = v_today
  where child.classroom_id = p_classroom_id
    and child.daycare_id = v_daycare_id
    and child.archived_at is null;

  insert into public.mobile_roll_call_sessions (
    daycare_id, classroom_id, attendance_date, completed_by, completed_at,
    present_count, absent_count, awaited_count
  ) values (
    v_daycare_id, p_classroom_id, v_today, auth.uid(), now(),
    coalesce(v_present, 0), coalesce(v_absent, 0), coalesce(v_awaited, 0)
  )
  on conflict (classroom_id, attendance_date) do update set
    completed_by = excluded.completed_by,
    completed_at = excluded.completed_at,
    present_count = excluded.present_count,
    absent_count = excluded.absent_count,
    awaited_count = excluded.awaited_count
  returning * into v_session;

  return jsonb_build_object(
    'id', v_session.id,
    'completedAt', v_session.completed_at,
    'present', v_session.present_count,
    'absent', v_session.absent_count,
    'awaited', v_session.awaited_count
  );
end;
$$;

create or replace function public.get_mobile_late_pickup_preview(p_child_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_today date := public.center_today();
  v_timezone text;
  v_expected_at timestamptz;
  v_now timestamptz := now();
  v_policy public.late_pickup_policies%rowtype;
  v_child_name text;
  v_presenter_name text;
  v_late_minutes integer;
  v_billable_minutes integer;
  v_month_count integer;
  v_conversation boolean;
  v_fee integer;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'Attendance edit permission is required';
  end if;
  if not exists (
    select 1 from public.attendance_records attendance
     where attendance.child_id = p_child_id and attendance.date = v_today
       and attendance.checked_in_at is not null and attendance.checked_out_at is null
  ) then raise exception 'This child is not currently checked in'; end if;

  select coalesce(center.timezone, 'UTC') into v_timezone
    from public.daycares center where center.id = v_daycare_id;
  select * into v_policy
    from public.late_pickup_policies policy
   where policy.daycare_id = v_daycare_id and policy.effective_from <= v_today
   order by policy.effective_from desc limit 1;

  if v_policy.id is null then
    v_policy.closing_time := time '18:00';
    v_policy.grace_minutes := 5;
    v_policy.fee_per_minute_cents := 100;
    v_policy.daily_cap_cents := 4000;
    v_policy.conversation_after_count := 3;
  end if;

  select child.first_name || ' ' || child.last_name,
         plan.presenter_name,
         coalesce(
           plan.scheduled_for,
           (v_today + v_policy.closing_time) at time zone v_timezone
         )
    into v_child_name, v_presenter_name, v_expected_at
    from public.children child
    left join lateral (
      select pickup.presenter_name, pickup.scheduled_for
        from public.pickup_plans pickup
       where pickup.child_id = child.id and pickup.scheduled_on = v_today
         and pickup.status = 'expected'
       order by pickup.created_at desc limit 1
    ) plan on true
   where child.id = p_child_id and child.daycare_id = v_daycare_id;

  v_late_minutes := greatest(ceil(extract(epoch from (v_now - v_expected_at)) / 60)::integer, 0);
  v_billable_minutes := greatest(v_late_minutes - v_policy.grace_minutes, 0);
  select count(*)::integer into v_month_count
    from public.late_pickup_events event
   where event.child_id = p_child_id
     and date_trunc('month', event.occurred_on::timestamp)
       = date_trunc('month', v_today::timestamp);
  v_conversation := v_month_count + 1 >= v_policy.conversation_after_count;
  v_fee := case when v_conversation then 0 else
    least(v_policy.daily_cap_cents, v_billable_minutes * v_policy.fee_per_minute_cents) end;

  return jsonb_build_object(
    'childId', p_child_id,
    'childName', v_child_name,
    'expectedAt', v_expected_at,
    'now', v_now,
    'expectedPickupName', v_presenter_name,
    'lateMinutes', v_late_minutes,
    'graceMinutes', v_policy.grace_minutes,
    'billableMinutes', v_billable_minutes,
    'feeCents', v_fee,
    'conversationRequired', v_conversation,
    'canLog', v_billable_minutes > 0
  );
end;
$$;

create or replace function public.complete_mobile_late_pickup(
  p_pass_id uuid,
  p_notes text default null
)
returns table (
  child_id uuid,
  child_name text,
  presenter_name text,
  relationship text,
  checked_out_at timestamptz,
  late_pickup_event_id uuid,
  late_minutes integer,
  billable_minutes integer,
  fee_cents integer,
  conversation_required boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_pass public.pickup_passes%rowtype;
  v_attendance_id uuid;
  v_preview jsonb;
  v_result record;
  v_event public.late_pickup_events%rowtype;
  v_policy_id uuid;
  v_note text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if length(coalesce(v_note, '')) > 500 then raise exception 'Note is too long'; end if;
  select * into v_pass from public.pickup_passes where id = p_pass_id;
  if v_pass.id is null then raise exception 'Pass is invalid, expired, or already used'; end if;

  select attendance.id into v_attendance_id
    from public.attendance_records attendance
   where attendance.child_id = v_pass.child_id
     and attendance.date = public.center_today()
     and attendance.checked_in_at is not null
     and attendance.checked_out_at is null
   for update;
  if v_attendance_id is null then raise exception 'This child is not currently checked in'; end if;

  v_preview := public.get_mobile_late_pickup_preview(v_pass.child_id);
  if not coalesce((v_preview ->> 'canLog')::boolean, false) then
    raise exception 'Pickup is not past the center grace period';
  end if;

  select policy.id into v_policy_id
    from public.late_pickup_policies policy
   where policy.daycare_id = v_pass.daycare_id
     and policy.effective_from <= public.center_today()
   order by policy.effective_from desc limit 1;

  -- Calling the existing verified checkout inside this function keeps the pass,
  -- attendance update, family notification and late fee in one transaction.
  select * into v_result from public.complete_mobile_pickup(p_pass_id);

  insert into public.late_pickup_events (
    daycare_id, child_id, attendance_id, policy_id, occurred_on,
    expected_at, picked_up_at, late_minutes, billable_minutes, fee_cents,
    conversation_required, collected_by, notes, recorded_by
  ) values (
    v_pass.daycare_id, v_pass.child_id, v_attendance_id, v_policy_id,
    public.center_today(), (v_preview ->> 'expectedAt')::timestamptz,
    v_result.checked_out_at, (v_preview ->> 'lateMinutes')::integer,
    (v_preview ->> 'billableMinutes')::integer,
    (v_preview ->> 'feeCents')::integer,
    (v_preview ->> 'conversationRequired')::boolean,
    v_result.presenter_name, v_note, auth.uid()
  ) returning * into v_event;

  return query select
    v_result.child_id, v_result.child_name, v_result.presenter_name,
    v_result.relationship, v_result.checked_out_at, v_event.id,
    v_event.late_minutes, v_event.billable_minutes, v_event.fee_cents,
    v_event.conversation_required;
end;
$$;

-- Attendance actions legitimately enqueue office notifications. Keep the
-- central mutation guard explicit instead of bypassing it in the client.
create or replace function public.enforce_notification_enqueue_permission()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_area text;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  if new.kind = 'time_off' then
    if not public.has_permission('staff', 'approve') then
      raise exception 'staff approve permission required';
    end if;
    return new;
  end if;
  v_area := case new.kind
    when 'announcement' then 'broadcasts'
    when 'incident' then 'incidents'
    when 'medication' then 'medications'
    when 'invoice' then 'billing'
    when 'payment' then 'billing'
    when 'staff_invite' then 'staff'
    when 'parent_invite' then 'children'
    when 'attendance' then 'attendance'
    else 'daily_logs'
  end;
  if not public.has_permission(v_area, 'edit') then
    raise exception '% edit permission required', v_area;
  end if;
  return new;
end;
$$;

revoke all on function public.get_mobile_roll_call(uuid) from public, anon;
revoke all on function public.mobile_roll_call_check_in(uuid) from public, anon;
revoke all on function public.mobile_mark_child_absent(uuid, text, text, boolean) from public, anon;
revoke all on function public.complete_mobile_roll_call(uuid) from public, anon;
revoke all on function public.get_mobile_late_pickup_preview(uuid) from public, anon;
revoke all on function public.complete_mobile_late_pickup(uuid, text) from public, anon;

grant execute on function public.get_mobile_roll_call(uuid) to authenticated;
grant execute on function public.mobile_roll_call_check_in(uuid) to authenticated;
grant execute on function public.mobile_mark_child_absent(uuid, text, text, boolean) to authenticated;
grant execute on function public.complete_mobile_roll_call(uuid) to authenticated;
grant execute on function public.get_mobile_late_pickup_preview(uuid) to authenticated;
grant execute on function public.complete_mobile_late_pickup(uuid, text) to authenticated;

comment on function public.get_mobile_roll_call(uuid) is
  'Returns the assigned classroom live roll-call dashboard, ratio and pickup timing.';
comment on function public.complete_mobile_late_pickup(uuid, text) is
  'Atomically verifies checkout through Group 19 and records the server-calculated late-pickup policy outcome.';

notify pgrst, 'reload schema';
