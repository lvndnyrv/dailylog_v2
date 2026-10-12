-- Admin request -> parent signature -> educator availability handoff.
-- All fixtures are rollback-only.
begin;
set local statement_timeout = '30s';

create function pg_temp.impersonate(p_role text, p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  center uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  parent_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  room_id uuid;
  child_id uuid;
  request_id uuid;
  label_path text;
  failed boolean;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (center, 'Rollback medication request room', 18, 72, 8, 4)
  returning id into room_id;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'med-request-parent-' || parent_id || '@dailylog.invalid', '', now(),
     '{"provider":"email","providers":["email"]}',
     '{"full_name":"Medication Request Parent"}', now(), now()),
    (outsider_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'med-request-outsider-' || outsider_id || '@dailylog.invalid', '', now(),
     '{"provider":"email","providers":["email"]}',
     '{"full_name":"Unlinked Parent"}', now(), now());
  update public.profiles set role = 'parent', daycare_id = center
   where id in (parent_id, outsider_id);

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Medication', 'Handoff', public.center_today() - 1200,
    public.center_today()
  ) returning id into child_id;
  insert into public.parent_children(parent_id, child_id, relationship, is_primary)
  values (parent_id, child_id, 'Parent', true);

  perform pg_temp.impersonate('authenticated', owner_id);
  failed := false;
  begin
    insert into public.medication_authorizations (
      daycare_id, child_id, parent_id, name, dosage, schedule, active
    ) values (
      center, child_id, parent_id, 'Unsafe active request', '5 ml', 'As needed', true
    );
  exception when others then failed := true;
  end;
  if not failed then
    raise exception 'FAIL: staff activated medication without a parent signature';
  end if;

  failed := false;
  begin
    insert into public.medication_authorizations (
      daycare_id, child_id, parent_id, name, dosage, schedule, active
    ) values (
      center, child_id, outsider_id, 'Unlinked request', '5 ml', 'As needed', false
    );
  exception when others then failed := true;
  end;
  if not failed then
    raise exception 'FAIL: staff assigned a medication request to an unlinked parent';
  end if;

  insert into public.medication_authorizations (
    daycare_id, child_id, parent_id, name, dosage, schedule, notes, active
  ) values (
    center, child_id, parent_id, 'Requested medication', '5 ml', 'As needed',
    'Prepared by the center for parent review', false
  ) returning id into request_id;

  perform pg_temp.impersonate('postgres', owner_id);
  if not exists (
    select 1 from public.notification_outbox outbox
     where outbox.recipient_id = parent_id
       and outbox.kind = 'medication'
       and outbox.dedupe_key = 'medication-authorization-request:' || request_id
       and outbox.payload->>'authorizationId' = request_id::text
       and outbox.payload->>'type' = 'medication_authorization_request'
  ) then raise exception 'FAIL: parent authorization request was not delivered'; end if;
  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = parent_id
       and notification.payload->>'authorizationId' = request_id::text
  ) then raise exception 'FAIL: parent authorization request is missing from the inbox'; end if;
  if not exists (
    select 1 from public.audit_log audit
     where audit.entity_type = 'medication_authorization'
       and audit.entity_id = request_id
       and audit.action = 'request_parent_authorization'
       and audit.actor_id = owner_id
  ) then raise exception 'FAIL: medication authorization request was not audited'; end if;

  label_path := child_id::text || '/' || parent_id::text || '/request-label.jpg';
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values (
    'medication-labels', label_path, parent_id, parent_id::text,
    jsonb_build_object('mimetype', 'image/jpeg', 'size', 2048)
  );

  perform pg_temp.impersonate('authenticated', parent_id);
  update public.medication_authorizations
     set route = 'Oral',
         medication_type = 'prescription',
         schedule_type = 'as_needed',
         as_needed_condition = 'Fever above 38.5 C',
         max_daily_doses = 3,
         start_date = public.center_today(),
         end_date = public.center_today() + 7,
         label_photo_path = label_path,
         signed_name = 'Medication Request Parent',
         signed_at = now(),
         consented_at = now(),
         authorization_version = '2026-08-09',
         active = true
   where id = request_id
     and medication_authorizations.parent_id = auth.uid();

  if not exists (
    select 1 from public.medication_authorizations auth_row
     where auth_row.id = request_id
       and auth_row.active
       and auth_row.signed_at is not null
       and auth_row.consented_at is not null
       and auth_row.label_photo_path = label_path
  ) then raise exception 'FAIL: linked parent could not complete the prepared request'; end if;

  perform pg_temp.impersonate('authenticated', outsider_id);
  if exists (
    select 1 from public.medication_authorizations auth_row
     where auth_row.id = request_id
  ) then raise exception 'FAIL: unlinked parent can read another family medication request'; end if;
end;
$$;

rollback;
select 'PASS: staff requests stay inactive, the linked parent is notified and can sign the same record, and other families remain isolated; rolled back' result;
