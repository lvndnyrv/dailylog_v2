-- ============================================================================
-- Parent mobile Group 23 completion
-- Adds a durable renewal chain, exact authorization-end audit fields, protects
-- signed label evidence, and marks medication dose pushes as high priority.
-- ============================================================================

alter table public.medication_authorizations
  add column if not exists renewed_from_id uuid
    references public.medication_authorizations(id) on delete set null,
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by uuid references public.profiles(id) on delete set null;

create index if not exists medication_authorizations_renewed_from_idx
  on public.medication_authorizations (renewed_from_id)
  where renewed_from_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'medication_authorizations_not_self_renewal_check'
      and conrelid = 'public.medication_authorizations'::regclass
  ) then
    alter table public.medication_authorizations
      add constraint medication_authorizations_not_self_renewal_check
      check (renewed_from_id is null or renewed_from_id <> id);
  end if;
end;
$$;

update public.medication_authorizations
set ended_at = coalesce(ended_at, updated_at, end_date::timestamptz)
where not active and ended_at is null;

create or replace function public.validate_parent_medication_authorization()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_role text;
  v_path_prefix text;
  v_prior public.medication_authorizations%rowtype;
  v_earliest_renewal date;
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

  if tg_op = 'INSERT' and new.renewed_from_id is not null then
    select * into v_prior
    from public.medication_authorizations prior
    where prior.id = new.renewed_from_id
      and prior.child_id = new.child_id
      and prior.parent_id = auth.uid()
      and prior.signed_at is not null;

    if v_prior.id is null then
      raise exception 'The medication renewal source is not available';
    end if;
    v_earliest_renewal := greatest(
      current_date,
      case when v_prior.active and v_prior.end_date is not null
        then v_prior.end_date + 1 else current_date end
    );
    if new.start_date < v_earliest_renewal then
      raise exception 'A renewal cannot overlap the current authorization';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.signed_at is not null then
    if row(
      new.child_id, new.parent_id, new.name, new.dosage, new.route,
      new.medication_type, new.schedule_type, new.scheduled_times,
      new.schedule, new.as_needed_condition, new.max_daily_doses,
      new.start_date, new.label_photo_path, new.signed_name, new.signed_at,
      new.consented_at, new.authorization_version, new.renewed_from_id
    ) is distinct from row(
      old.child_id, old.parent_id, old.name, old.dosage, old.route,
      old.medication_type, old.schedule_type, old.scheduled_times,
      old.schedule, old.as_needed_condition, old.max_daily_doses,
      old.start_date, old.label_photo_path, old.signed_name, old.signed_at,
      old.consented_at, old.authorization_version, old.renewed_from_id
    ) then
      raise exception 'Signed medication details cannot be edited; end this authorization and create a new one';
    end if;
    if (not old.active and new.active)
       or (old.end_date is not null and (new.end_date is null or new.end_date > old.end_date)) then
      raise exception 'A parent may end, but cannot extend or reactivate, a signed authorization';
    end if;

    if old.active and not new.active then
      new.end_date := least(coalesce(new.end_date, current_date), current_date);
      new.ended_at := now();
      new.ended_by := auth.uid();
    elsif not old.active then
      new.ended_at := old.ended_at;
      new.ended_by := old.ended_by;
    end if;
  end if;

  return new;
end;
$$;

-- A failed authorization insert may clean up its orphan upload. Once a signed
-- record references the object, nobody can replace or remove that evidence.
drop policy if exists "authorized users replace medication labels" on storage.objects;
drop policy if exists "authorized users replace unreferenced medication labels" on storage.objects;
create policy "authorized users replace unreferenced medication labels"
  on storage.objects for update
  using (
    bucket_id = 'medication-labels'
    and not exists (
      select 1 from public.medication_authorizations med_auth
      where med_auth.label_photo_path = storage.objects.name and med_auth.signed_at is not null
    )
    and (
      (public.get_my_role() = 'parent'
        and ((storage.foldername(name))[1])::uuid in (select public.my_child_ids()))
      or (public.has_permission('medications', 'edit')
        and public.can_write_child(((storage.foldername(name))[1])::uuid))
    )
  )
  with check (
    bucket_id = 'medication-labels'
    and not exists (
      select 1 from public.medication_authorizations med_auth
      where med_auth.label_photo_path = storage.objects.name and med_auth.signed_at is not null
    )
    and (
      (public.get_my_role() = 'parent'
        and ((storage.foldername(name))[1])::uuid in (select public.my_child_ids()))
      or (public.has_permission('medications', 'edit')
        and public.can_write_child(((storage.foldername(name))[1])::uuid))
    )
  );

drop policy if exists "authorized users remove medication labels" on storage.objects;
drop policy if exists "authorized users remove unreferenced medication labels" on storage.objects;
create policy "authorized users remove unreferenced medication labels"
  on storage.objects for delete
  using (
    bucket_id = 'medication-labels'
    and not exists (
      select 1 from public.medication_authorizations med_auth
      where med_auth.label_photo_path = storage.objects.name and med_auth.signed_at is not null
    )
    and (
      (public.get_my_role() = 'parent'
        and ((storage.foldername(name))[1])::uuid in (select public.my_child_ids()))
      or (public.has_permission('medications', 'edit')
        and public.can_write_child(((storage.foldername(name))[1])::uuid))
    )
  );

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
      'priority', 'high',
      'channelId', 'default'
    ),
    'medication-dose:' || new.id,
    array['push']::text[]
  );

  return new;
end;
$$;
