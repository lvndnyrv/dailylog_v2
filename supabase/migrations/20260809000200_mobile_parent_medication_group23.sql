-- Parent Mobile Group 23: auditable medication authorization, structured
-- schedules, upcoming doses, and durable parent dose notifications.

alter table public.medication_authorizations
  add column if not exists medication_type text not null default 'prescription',
  add column if not exists schedule_type text not null default 'as_needed',
  add column if not exists scheduled_times time without time zone[] not null default '{}',
  add column if not exists consented_at timestamptz,
  add column if not exists authorization_version text not null default '2026-08-09';

update public.medication_authorizations
   set medication_type = case
         when lower(coalesce(notes, '')) like '%over-the-counter%'
           then 'over_the_counter'
         else 'prescription'
       end,
       schedule_type = case
         when nullif(btrim(as_needed_condition), '') is not null
           or lower(coalesce(schedule, '')) like '%as needed%'
           or lower(coalesce(schedule, '')) like '%emergency%'
           then 'as_needed'
         else 'scheduled'
       end,
       consented_at = coalesce(consented_at, signed_at),
       authorization_version = coalesce(nullif(authorization_version, ''), '2026-08-09');

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'medication_authorizations_medication_type_check'
       and conrelid = 'public.medication_authorizations'::regclass
  ) then
    alter table public.medication_authorizations
      add constraint medication_authorizations_medication_type_check
      check (medication_type in ('prescription', 'over_the_counter'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'medication_authorizations_schedule_type_check'
       and conrelid = 'public.medication_authorizations'::regclass
  ) then
    alter table public.medication_authorizations
      add constraint medication_authorizations_schedule_type_check
      check (schedule_type in ('scheduled', 'as_needed'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'medication_authorizations_max_daily_doses_check'
       and conrelid = 'public.medication_authorizations'::regclass
  ) then
    alter table public.medication_authorizations
      add constraint medication_authorizations_max_daily_doses_check
      check (max_daily_doses is null or max_daily_doses between 1 and 24);
  end if;
end;
$$;

create index if not exists medication_authorizations_active_schedule_idx
  on public.medication_authorizations (child_id, schedule_type, start_date, end_date)
  where active;

create or replace function public.validate_parent_medication_authorization()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_role text;
  v_path_prefix text;
begin
  -- Migration and reset seeds run without a request identity. Product writes
  -- are authenticated and receive the full legal/safety validation below.
  if auth.uid() is null then
    return new;
  end if;

  v_role := public.get_my_role();
  if v_role <> 'parent' then
    return new;
  end if;

  if new.parent_id is distinct from auth.uid()
     or new.child_id not in (select public.my_child_ids()) then
    raise exception 'Parents may only authorize medication for their linked child';
  end if;

  new.name := btrim(coalesce(new.name, ''));
  new.dosage := btrim(coalesce(new.dosage, ''));
  new.route := btrim(coalesce(new.route, ''));
  new.schedule := nullif(btrim(coalesce(new.schedule, '')), '');
  new.as_needed_condition := nullif(btrim(coalesce(new.as_needed_condition, '')), '');
  new.signed_name := btrim(coalesce(new.signed_name, ''));
  new.authorization_version := btrim(coalesce(new.authorization_version, ''));
  new.start_date := coalesce(new.start_date, current_date);

  if length(new.name) not between 2 and 120
     or length(new.dosage) not between 1 and 80
     or length(new.route) not between 2 and 40 then
    raise exception 'Medication name, dose, and route are required';
  end if;
  if new.end_date is null or new.end_date < new.start_date then
    raise exception 'Authorization end date must be on or after its start date';
  end if;
  if new.end_date > new.start_date + 365 then
    raise exception 'Medication authorization cannot exceed one year';
  end if;

  if new.schedule_type = 'scheduled' then
    if cardinality(coalesce(new.scheduled_times, '{}'::time[])) = 0 then
      raise exception 'Add at least one scheduled dose time';
    end if;
    new.as_needed_condition := null;
  else
    new.scheduled_times := '{}'::time[];
    if new.as_needed_condition is null then
      raise exception 'Describe when this as-needed medication should be given';
    end if;
    if new.max_daily_doses is null then
      raise exception 'Maximum daily doses are required for as-needed medication';
    end if;
    if new.end_date > new.start_date + 30 then
      raise exception 'As-needed medication authorizations are limited to 30 days';
    end if;
  end if;

  v_path_prefix := new.child_id::text || '/' || auth.uid()::text || '/';
  if nullif(btrim(coalesce(new.label_photo_path, '')), '') is null
     or new.label_photo_path not like v_path_prefix || '%'
     or not exists (
       select 1 from storage.objects object
        where object.bucket_id = 'medication-labels'
          and object.name = new.label_photo_path
     ) then
    raise exception 'A private medication label photo is required';
  end if;
  if length(new.signed_name) < 2
     or new.signed_at is null
     or new.consented_at is null
     or new.authorization_version = '' then
    raise exception 'Consent and a legal signature are required';
  end if;

  if tg_op = 'UPDATE' and old.signed_at is not null then
    if row(
      new.child_id, new.parent_id, new.name, new.dosage, new.route,
      new.medication_type, new.schedule_type, new.scheduled_times,
      new.schedule, new.as_needed_condition, new.max_daily_doses,
      new.start_date, new.label_photo_path, new.signed_name, new.signed_at,
      new.consented_at, new.authorization_version
    ) is distinct from row(
      old.child_id, old.parent_id, old.name, old.dosage, old.route,
      old.medication_type, old.schedule_type, old.scheduled_times,
      old.schedule, old.as_needed_condition, old.max_daily_doses,
      old.start_date, old.label_photo_path, old.signed_name, old.signed_at,
      old.consented_at, old.authorization_version
    ) then
      raise exception 'Signed medication details cannot be edited; end this authorization and create a new one';
    end if;
    if (not old.active and new.active)
       or (old.end_date is not null and (new.end_date is null or new.end_date > old.end_date)) then
      raise exception 'A parent may end, but cannot extend or reactivate, a signed authorization';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_parent_medication_authorization
  on public.medication_authorizations;
create trigger validate_parent_medication_authorization
  before insert or update on public.medication_authorizations
  for each row execute function public.validate_parent_medication_authorization();

create or replace function public.stamp_medication_parent_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.parent_notified_at := coalesce(new.parent_notified_at, now());
  return new;
end;
$$;

drop trigger if exists stamp_medication_parent_notification
  on public.medication_logs;
create trigger stamp_medication_parent_notification
  before insert on public.medication_logs
  for each row execute function public.stamp_medication_parent_notification();

create or replace function public.route_medication_parent_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_name text;
  v_medication_name text;
begin
  -- SQL seeds have no signed-in staff actor and should not create delivery
  -- noise. Every authenticated dose is validated as a staff write first.
  if auth.uid() is null then
    return new;
  end if;

  select concat_ws(' ', child.first_name, child.last_name), auth_row.name
    into v_child_name, v_medication_name
    from public.children child
    join public.medication_authorizations auth_row
      on auth_row.id = new.authorization_id
   where child.id = new.child_id;

  perform public.enqueue_child_notification(
    new.child_id,
    'medication',
    'Medication given to ' || v_child_name,
    v_medication_name || ' · ' || coalesce(new.dosage_given, 'dose recorded') ||
      '. Tap to see the complete record.',
    jsonb_build_object(
      'screen', 'Medication',
      'type', 'medication',
      'childId', new.child_id,
      'authorizationId', new.authorization_id,
      'medicationLogId', new.id,
      'channelId', 'default'
    ),
    'medication-dose:' || new.id,
    array['push']::text[]
  );

  return new;
end;
$$;

drop trigger if exists route_medication_parent_notification
  on public.medication_logs;
create trigger route_medication_parent_notification
  after insert on public.medication_logs
  for each row execute function public.route_medication_parent_notification();
