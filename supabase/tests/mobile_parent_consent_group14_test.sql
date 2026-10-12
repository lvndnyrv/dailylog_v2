-- Parent Mobile Group 14 consent gate, audit, and center notification tests.
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
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_foreign_child constant uuid := '30000000-0000-4000-a000-000000000002';
  v_result jsonb;
  v_count int;
  v_failed boolean;
begin
  perform pg_temp.impersonate('postgres');
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, current_date), current_date)
   where id = v_child;
  perform pg_temp.impersonate('authenticated', v_parent);

  v_failed := false;
  begin
    update public.parent_children
       set consent_given_at = now()
     where parent_id = v_parent and child_id = v_child;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: parent bypassed the audited consent RPC';
  end if;

  v_failed := false;
  begin
    update public.parent_children
       set pickup_authorized = false
     where parent_id = v_parent and child_id = v_child;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: parent altered protected link permissions';
  end if;
  raise notice 'PASS: direct consent and link-permission bypasses are rejected';

  v_result := public.set_parent_care_data_consent(v_child, false, 'group14-test');
  if (v_result->>'granted')::boolean
     or not (v_result->>'centerNotified')::boolean then
    raise exception 'FAIL: decline result is incomplete: %', v_result;
  end if;

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.parent_children
     where parent_id = v_parent and child_id = v_child
       and consent_given_at is null
       and consent_declined_at is not null
       and consent_version = 'group14-test'
  ) then
    raise exception 'FAIL: declined consent state was not persisted';
  end if;
  select count(*) into v_count
    from public.notifications notification
   where notification.kind = 'consent_declined'
     and notification.payload->>'childId' = v_child::text
     and notification.payload->>'parentId' = v_parent::text;
  if v_count < 1 then
    raise exception 'FAIL: center admins were not notified of the decline';
  end if;
  if not exists (
    select 1 from public.audit_log audit
     where audit.actor_id = v_parent
       and audit.entity_id = v_child
       and audit.action = 'parent_care_data_consent_declined'
  ) then
    raise exception 'FAIL: decline was not written to the audit trail';
  end if;
  raise notice 'PASS: decline is durable, audited, and notifies the center';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_result := public.set_parent_care_data_consent(v_child, true, 'group14-test');
  if not (v_result->>'granted')::boolean then
    raise exception 'FAIL: consent grant did not succeed: %', v_result;
  end if;

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.parent_children
     where parent_id = v_parent and child_id = v_child
       and consent_given_at is not null
       and consent_declined_at is null
  ) then
    raise exception 'FAIL: consent grant did not replace declined state';
  end if;
  raise notice 'PASS: parent can grant consent after changing their mind';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.set_parent_care_data_consent(v_foreign_child, true, 'group14-test');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: parent changed consent for an unrelated child';
  end if;
  raise notice 'PASS: cross-family consent changes are rejected';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 14 CONSENT TESTS: ALL PASSED' as result;
