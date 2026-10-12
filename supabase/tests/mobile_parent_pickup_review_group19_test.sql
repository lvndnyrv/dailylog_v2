-- Parent Mobile Group 19 pickup review, credential gating, and realtime tests.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_restricted constant uuid := '00000000-0000-4000-a000-000000000008';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_daycare uuid;
  v_restricted_role uuid;
  v_pickup uuid;
  v_rejected uuid;
  v_result jsonb;
  v_count integer;
  v_failed boolean;
begin
  perform pg_temp.impersonate('postgres');
  select daycare_id into v_daycare from public.profiles where id = v_owner;
  insert into public.center_roles (daycare_id, name, base_role, permissions)
  values (
    v_daycare,
    'Rollback-only pickup viewer',
    'admin',
    '{"children":{"view":true,"edit":false,"approve":false}}'
  ) returning id into v_restricted_role;
  perform pg_temp.impersonate('authenticated', v_owner);
  update public.profiles
     set role = 'admin', center_role_id = v_restricted_role, archived_at = null
   where id = v_restricted;
  update public.staff_delegations
     set revoked_at = now()
   where delegate_profile_id = v_restricted and revoked_at is null;
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, current_date), current_date)
   where id = v_child;
  if (
    select count(*)
      from pg_publication_tables publication_table
     where publication_table.pubname = 'supabase_realtime'
       and publication_table.schemaname = 'public'
       and publication_table.tablename in (
         'parent_absence_reports', 'attendance_records', 'child_pickups',
         'pickup_passes', 'pickup_plans'
       )
  ) <> 5 then
    raise exception 'FAIL: Group 19 realtime tables are not fully published';
  end if;
  raise notice 'PASS: Group 19 absence and pickup state are realtime-enabled';

  perform pg_temp.impersonate('authenticated', v_parent);
  select added.id into v_pickup
    from public.parent_add_authorized_pickup(
      v_child, 'Group 19 Review Test', 'Grandparent', '905-555-0199'
    ) added;

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.child_pickups pickup
     where pickup.id = v_pickup
       and pickup.approval_status = 'pending'
       and pickup.requested_by = v_parent
       and pickup.reviewed_at is null
  ) then raise exception 'FAIL: parent-added pickup was not held for review'; end if;
  if not exists (
    select 1 from public.notifications notification
     where notification.kind = 'pickup_review'
       and notification.payload->>'pickupId' = v_pickup::text
       and notification.profile_id = v_owner
  ) then raise exception 'FAIL: owner was not notified about the review'; end if;
  if exists (
    select 1 from public.notifications notification
     where notification.kind = 'pickup_review'
       and notification.payload->>'pickupId' = v_pickup::text
       and notification.profile_id = v_restricted
  ) or exists (
    select 1 from public.notification_outbox queued
     where queued.kind = 'pickup_review'
       and queued.payload->>'pickupId' = v_pickup::text
       and queued.recipient_id = v_restricted
  ) then raise exception 'FAIL: restricted administrator received an unusable pickup-review alert'; end if;
  if not exists (
    select 1 from public.audit_log audit
     where audit.entity_type = 'child_pickups'
       and audit.entity_id = v_pickup
       and audit.action = 'insert'
       and audit.actor_id = v_parent
  ) then raise exception 'FAIL: parent pickup request was not audited'; end if;
  raise notice 'PASS: parent additions are pending and notify the center';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.create_mobile_pickup_pass(v_child, null, v_pickup, null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: pending pickup created a mobile pass'; end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  select count(*) into v_count
    from public.kiosk_lookup_pin((select pin from public.child_pickups where id = v_pickup));
  if v_count <> 0 then raise exception 'FAIL: pending pickup PIN worked at the kiosk'; end if;
  raise notice 'PASS: pending pickup is blocked from mobile and kiosk credentials';

  if public.review_parent_authorized_pickup(v_pickup, 'approved', null) <> 'approved' then
    raise exception 'FAIL: center approval did not return approved';
  end if;
  if not exists (
    select 1 from public.audit_log audit
     where audit.entity_type = 'child_pickups'
       and audit.entity_id = v_pickup
       and audit.action = 'update'
       and audit.actor_id = v_owner
       and audit.after->>'approval_status' = 'approved'
  ) then raise exception 'FAIL: center pickup decision was not audited'; end if;
  perform pg_temp.impersonate('authenticated', v_parent);
  select to_jsonb(pass) into v_result
    from public.create_mobile_pickup_pass(v_child, null, v_pickup, null) pass;
  if nullif(v_result->>'pass_id', '') is null then
    raise exception 'FAIL: approved pickup could not create a pass';
  end if;
  raise notice 'PASS: approval enables a short-lived pickup pass';

  select added.id into v_rejected
    from public.parent_add_authorized_pickup(
      v_child, 'Group 19 Rejected Test', 'Family friend', null
    ) added;
  perform pg_temp.impersonate('authenticated', v_owner);
  perform public.review_parent_authorized_pickup(
    v_rejected, 'rejected', 'Please bring photo ID to the office.'
  );
  perform pg_temp.impersonate('authenticated', v_parent);
  if not exists (
    select 1 from public.get_parent_pickup_options(v_child, true) option
     where option.source_id = v_rejected
       and option.approval_status = 'rejected'
       and not option.is_active
       and option.review_note = 'Please bring photo ID to the office.'
  ) then raise exception 'FAIL: rejection state was not visible to the parent'; end if;
  v_failed := false;
  begin
    perform public.create_mobile_pickup_pass(v_child, null, v_rejected, null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: rejected pickup created a mobile pass'; end if;
  raise notice 'PASS: rejection is visible and remains credential-blocked';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 19 PICKUP REVIEW TESTS: ALL PASSED' as result;
