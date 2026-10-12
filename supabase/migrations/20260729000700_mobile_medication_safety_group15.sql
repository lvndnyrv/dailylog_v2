-- Mobile educator Group 15: complete medication authorizations and witnessed
-- dose administration.

alter table medication_authorizations
  add column if not exists route text,
  add column if not exists as_needed_condition text,
  add column if not exists max_daily_doses integer,
  add column if not exists label_photo_path text,
  add column if not exists signed_name text,
  add column if not exists signed_at timestamptz;

alter table medication_logs
  add column if not exists witness_id uuid references profiles(id) on delete set null,
  add column if not exists route_given text,
  add column if not exists safety_checks jsonb not null default
    '{"right_child": false, "right_medication": false, "right_dose": false, "right_route": false, "right_time": false}'::jsonb,
  add column if not exists parent_notified_at timestamptz;

create index if not exists medication_logs_witness_idx
  on medication_logs (witness_id, administered_at desc);

create or replace function medication_rows_sync_daycare_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select c.daycare_id
    into new.daycare_id
    from children c
   where c.id = new.child_id;

  if new.daycare_id is null then
    raise exception 'Medication record requires a child in an active center';
  end if;

  return new;
end;
$$;

drop trigger if exists medication_authorizations_sync_daycare
  on medication_authorizations;
create trigger medication_authorizations_sync_daycare
  before insert or update of child_id on medication_authorizations
  for each row execute function medication_rows_sync_daycare_id();

drop trigger if exists medication_logs_sync_daycare on medication_logs;
create trigger medication_logs_sync_daycare
  before insert or update of child_id on medication_logs
  for each row execute function medication_rows_sync_daycare_id();

create or replace function validate_medication_log_safety()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_row medication_authorizations%rowtype;
begin
  select *
    into auth_row
    from medication_authorizations
   where id = new.authorization_id
     and child_id = new.child_id;

  if auth_row.id is null then
    raise exception 'The selected medication is not authorized for this child';
  end if;

  if not auth_row.active
     or auth_row.start_date > new.administered_at::date
     or (
       auth_row.end_date is not null
       and auth_row.end_date < new.administered_at::date
     ) then
    raise exception 'This medication authorization is not currently active';
  end if;

  if new.witness_id is null then
    raise exception 'A second staff witness is required';
  end if;

  if new.witness_id = new.administered_by then
    raise exception 'The administering educator cannot witness their own dose';
  end if;

  if not exists (
    select 1
     from profiles witness
     where witness.id = new.witness_id
       and witness.daycare_id = auth_row.daycare_id
       and witness.role in ('owner_admin', 'admin', 'educator')
  ) then
    raise exception 'The witness must be an active staff member at this center';
  end if;

  if not (
    coalesce((new.safety_checks ->> 'right_child')::boolean, false)
    and coalesce((new.safety_checks ->> 'right_medication')::boolean, false)
    and coalesce((new.safety_checks ->> 'right_dose')::boolean, false)
    and coalesce((new.safety_checks ->> 'right_route')::boolean, false)
    and coalesce((new.safety_checks ->> 'right_time')::boolean, false)
  ) then
    raise exception 'All five medication safety rights must be confirmed';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_medication_log_safety on medication_logs;
create trigger validate_medication_log_safety
  before insert or update on medication_logs
  for each row execute function validate_medication_log_safety();

insert into storage.buckets (id, name, public)
values ('medication-labels', 'medication-labels', false)
on conflict (id) do update set public = false;

drop policy if exists "linked users read medication labels" on storage.objects;
create policy "linked users read medication labels"
  on storage.objects for select
  using (
    bucket_id = 'medication-labels'
    and can_access_child(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "authorized users upload medication labels" on storage.objects;
create policy "authorized users upload medication labels"
  on storage.objects for insert
  with check (
    bucket_id = 'medication-labels'
    and (
      (
        get_my_role() = 'parent'
        and ((storage.foldername(name))[1])::uuid in (select my_child_ids())
      )
      or (
        has_permission('medications', 'edit')
        and can_write_child(((storage.foldername(name))[1])::uuid)
      )
    )
  );

drop policy if exists "authorized users replace medication labels" on storage.objects;
create policy "authorized users replace medication labels"
  on storage.objects for update
  using (
    bucket_id = 'medication-labels'
    and (
      (
        get_my_role() = 'parent'
        and ((storage.foldername(name))[1])::uuid in (select my_child_ids())
      )
      or (
        has_permission('medications', 'edit')
        and can_write_child(((storage.foldername(name))[1])::uuid)
      )
    )
  );

drop policy if exists "authorized users remove medication labels" on storage.objects;
create policy "authorized users remove medication labels"
  on storage.objects for delete
  using (
    bucket_id = 'medication-labels'
    and (
      (
        get_my_role() = 'parent'
        and ((storage.foldername(name))[1])::uuid in (select my_child_ids())
      )
      or (
        has_permission('medications', 'edit')
        and can_write_child(((storage.foldername(name))[1])::uuid)
      )
    )
  );

update medication_authorizations
   set route = case
     when lower(name) like '%inhaler%' or lower(dosage) like '%puff%' then 'Inhaled'
     when lower(name) like '%epipen%' then 'Injection'
     else 'Oral'
   end
 where route is null;
