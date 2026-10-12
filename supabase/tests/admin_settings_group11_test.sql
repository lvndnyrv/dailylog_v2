-- Rollback-safe Group 11 settings, policy history, audit and role checks.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', case when p_role = 'postgres' then 'service_role' else p_role end)::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_daycare uuid;
  v_parent uuid;
  v_children integer;
  v_policy uuid;
  v_closure uuid;
begin
  select daycare_id into v_daycare from public.profiles where id = v_owner;
  if v_daycare is null then raise exception 'Missing dev owner fixture'; end if;
  select id into v_parent from public.profiles where daycare_id = v_daycare and role = 'parent' limit 1;
  if v_parent is null then raise exception 'Missing dev parent fixture'; end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  update public.daycares set license_number = 'ROLLBACK-G11' where id = v_daycare;
  if not exists (
    select 1 from public.audit_log
    where daycare_id = v_daycare and entity_type = 'daycares'
      and after ->> 'license_number' = 'ROLLBACK-G11'
  ) then raise exception 'FAIL: center profile edit was not audited'; end if;

  select count(*)::integer into v_children from public.children
  where daycare_id = v_daycare and archived_at is null;
  begin
    update public.daycares set licensed_capacity = greatest(v_children - 1, 0) where id = v_daycare;
    if v_children > 0 then raise exception 'FAIL: capacity was lowered below active child records'; end if;
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  select public.save_late_pickup_policy(125, 7, 4500, 4) into v_policy;
  if not exists (
    select 1 from public.late_pickup_policies
    where id = v_policy and effective_from = public.center_today() + 1
      and fee_per_minute_cents = 125 and grace_minutes = 7
      and daily_cap_cents = 4500 and conversation_after_count = 4
  ) then raise exception 'FAIL: next-day policy version was not saved'; end if;
  if not exists (
    select 1 from public.audit_log
    where entity_type = 'late_pickup_policies' and entity_id = v_policy
  ) then raise exception 'FAIL: policy change was not audited'; end if;

  insert into public.center_closures (
    daycare_id, starts_on, ends_on, reason, family_visible,
    billing_treatment, reminder_days_before, published_at
  ) values (
    v_daycare, date '2099-11-15', date '2099-11-15', 'Rollback Group 11', false,
    'no_charge', 3, now()
  ) returning id into v_closure;
  delete from public.center_closures where id = v_closure;
  if (select count(*) from public.audit_log where entity_id = v_closure) <> 2 then
    raise exception 'FAIL: closure create/cancel audit trail is incomplete';
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  begin
    perform public.save_late_pickup_policy(100, 5, 4000, 3);
    raise exception 'FAIL: parent changed center policy';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.record_audit_log_export(10);
    raise exception 'FAIL: parent recorded an admin audit export';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

rollback;
select 'PASS: Group 11 center facts, closure lifecycle, next-day late-pickup policy, audit history and admin boundaries are enforced' as result;
