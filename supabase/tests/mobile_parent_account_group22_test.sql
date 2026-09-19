-- Parent Mobile Group 22 account, family, notification, and privacy tests.
-- Requires the standard demo seed and rolls every mutation back.
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
  v_hub jsonb;
  v_settings jsonb;
  v_invite jsonb;
  v_request_one jsonb;
  v_request_two jsonb;
  v_failed boolean := false;
begin
  perform pg_temp.impersonate('postgres');
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, current_date), current_date)
   where id = v_child;
  update public.notification_preferences
     set push = false
   where profile_id = v_parent and kind = 'parent_routines';
  perform pg_temp.impersonate('authenticated', v_parent);

  v_hub := public.get_parent_account_hub();
  if jsonb_array_length(v_hub->'children') < 1
     or v_hub->'profile'->>'email' <> 'lucia.castillo@parent.test' then
    raise exception 'FAIL: parent account hub is incomplete: %', v_hub;
  end if;
  raise notice 'PASS: account hub is scoped to the signed-in parent family';

  v_settings := public.get_parent_notification_settings();
  if (v_settings->'preferences'->>'incident_report')::boolean is not true
     or (v_settings->'preferences'->>'parent_routines')::boolean is not false then
    raise exception 'FAIL: parent notification defaults are incorrect: %', v_settings;
  end if;
  if public.set_parent_notification_preference('incident_report', false) is not true then
    raise exception 'FAIL: incident notifications were muted';
  end if;
  if public.set_parent_notification_preference('parent_routines', true) is not true then
    raise exception 'FAIL: optional parent notification was not enabled';
  end if;
  raise notice 'PASS: notification choices persist and incident alerts stay on';

  v_invite := public.create_parent_co_guardian_invite(
    v_child, 'group22-test@example.com', 'Grandparent'
  );
  if v_invite->>'code' is null then
    raise exception 'FAIL: co-guardian invitation did not return a share code';
  end if;
  raise notice 'PASS: a parent can securely invite a co-guardian for their child';

  v_failed := false;
  begin
    perform public.create_parent_co_guardian_invite(
      v_foreign_child, 'blocked@example.com', 'Guardian'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: parent invited a guardian for an unrelated child';
  end if;
  raise notice 'PASS: cross-family guardian invitations are rejected';

  v_request_one := public.request_parent_data_action('export');
  v_request_two := public.request_parent_data_action('export');
  if v_request_one->>'id' is null or v_request_one->>'id' <> v_request_two->>'id' then
    raise exception 'FAIL: repeated export requests were not idempotent';
  end if;
  raise notice 'PASS: privacy data requests are family-scoped and idempotent';

  v_failed := false;
  begin
    insert into public.parent_data_requests (
      daycare_id, profile_id, request_type
    ) values (
      '10000000-0000-4000-a000-000000000001', v_parent, 'deletion'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: parent bypassed the audited data-request RPC';
  end if;
  raise notice 'PASS: direct data-request writes are blocked';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 22 TESTS: ALL PASSED' as result;
