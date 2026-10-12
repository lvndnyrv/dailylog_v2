-- ============================================================================
-- Parent mobile Group 23: signed-record and dose integrity hardening
-- UI safety checks are useful, but medication facts must also be immutable and
-- verified by the database for every authenticated client.
-- ============================================================================

create or replace function public.protect_signed_medication_authorization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.signed_at is null then
    return new;
  end if;

  -- These values are the evidence the parent signed. Neither staff nor a
  -- modified client may rewrite them. Ending an authorization is handled below.
  if row(
    new.daycare_id, new.child_id, new.parent_id, new.name, new.dosage,
    new.route, new.medication_type, new.schedule_type, new.scheduled_times,
    new.schedule, new.as_needed_condition, new.max_daily_doses, new.notes,
    new.start_date, new.label_photo_path, new.signed_name, new.signed_at,
    new.consented_at, new.authorization_version, new.renewed_from_id
  ) is distinct from row(
    old.daycare_id, old.child_id, old.parent_id, old.name, old.dosage,
    old.route, old.medication_type, old.schedule_type, old.scheduled_times,
    old.schedule, old.as_needed_condition, old.max_daily_doses, old.notes,
    old.start_date, old.label_photo_path, old.signed_name, old.signed_at,
    old.consented_at, old.authorization_version, old.renewed_from_id
  ) then
    raise exception 'Signed medication details cannot be edited; end this authorization and create a new one';
  end if;

  if not old.active and new.active then
    raise exception 'An ended medication authorization cannot be reactivated';
  end if;

  if old.end_date is not null
     and (new.end_date is null or new.end_date > old.end_date) then
    raise exception 'A signed medication authorization cannot be extended; create a renewal instead';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_signed_medication_authorization
  on public.medication_authorizations;
create trigger protect_signed_medication_authorization
  before update on public.medication_authorizations
  for each row execute function public.protect_signed_medication_authorization();

create or replace function public.enforce_medication_dose_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_authorization public.medication_authorizations%rowtype;
  v_duplicate uuid;
begin
  select * into v_authorization
  from public.medication_authorizations auth_row
  where auth_row.id = new.authorization_id
    and auth_row.child_id = new.child_id;

  if v_authorization.id is null then
    raise exception 'The selected medication is not authorized for this child';
  end if;

  if new.daycare_id is distinct from v_authorization.daycare_id then
    raise exception 'The medication record belongs to a different center';
  end if;

  if btrim(coalesce(new.dosage_given, '')) <> btrim(v_authorization.dosage)
     or lower(btrim(coalesce(new.route_given, ''))) <> lower(btrim(v_authorization.route)) then
    raise exception 'The logged dose and route must exactly match the signed authorization';
  end if;

  if char_length(coalesce(new.notes, '')) > 2000 then
    raise exception 'Medication dose notes must be 2000 characters or fewer';
  end if;

  -- Serialize near-simultaneous submissions for one authorization. This catches
  -- double taps/retries before two staff clients can record the same dose twice.
  perform pg_advisory_xact_lock(hashtextextended(v_authorization.id::text, 23));
  select medication_log.id into v_duplicate
  from public.medication_logs medication_log
  where medication_log.authorization_id = new.authorization_id
    and medication_log.id is distinct from new.id
    and medication_log.administered_at between
      new.administered_at - interval '2 minutes'
      and new.administered_at + interval '2 minutes'
  limit 1;

  if v_duplicate is not null then
    raise exception 'A dose for this medication was already logged within the last two minutes';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_medication_dose_integrity
  on public.medication_logs;
create trigger enforce_medication_dose_integrity
  before insert on public.medication_logs
  for each row execute function public.enforce_medication_dose_integrity();

revoke all on function public.protect_signed_medication_authorization() from public, anon, authenticated;
revoke all on function public.enforce_medication_dose_integrity() from public, anon, authenticated;
