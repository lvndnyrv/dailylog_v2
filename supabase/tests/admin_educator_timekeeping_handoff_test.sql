-- Rollback-safe educator clock-in/out -> admin approval -> educator status and
-- routed decision notification.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_unrelated uuid := '00000000-0000-4000-a000-000000000004';
  v_member uuid;
  v_entry uuid;
begin
  perform pg_temp.impersonate('postgres');
  select id into v_member
    from public.staff_members
   where profile_id = v_educator
     and status = 'active'
     and archived_at is null;
  if v_member is null then raise exception 'Missing active educator fixture'; end if;
  delete from public.staff_time_entries
   where staff_member_id = v_member
     and clocked_out_at is null;

  perform pg_temp.impersonate('authenticated', v_educator);
  v_entry := public.clock_in(null, now() - interval '1 hour');
  perform public.clock_out(now(), 0);
  if not exists (
    select 1 from public.staff_time_entries entry
     where entry.id = v_entry
       and entry.status = 'submitted'
       and entry.clocked_out_at is not null
  ) then
    raise exception 'FAIL: educator clock-out did not submit a reviewable entry';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  perform public.approve_time_entry(v_entry, true, 'Hours verified.');

  perform pg_temp.impersonate('authenticated', v_educator);
  if not exists (
    select 1 from public.staff_time_entries entry
     where entry.id = v_entry
       and entry.status = 'approved'
       and entry.notes = 'Hours verified.'
  ) then
    raise exception 'FAIL: educator cannot see the approved entry state';
  end if;
  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_educator
       and notification.kind = 'timesheet_review'
       and notification.payload ->> 'screen' = 'WeeklyTimesheet'
       and notification.payload ->> 'entryId' = v_entry::text
       and notification.payload ->> 'status' = 'approved'
  ) then
    raise exception 'FAIL: approval did not create a routed educator alert';
  end if;

  perform pg_temp.impersonate('authenticated', v_unrelated);
  if exists (
    select 1 from public.staff_time_entries entry where entry.id = v_entry
  ) or exists (
    select 1 from public.notifications notification
     where notification.payload ->> 'entryId' = v_entry::text
  ) then
    raise exception 'FAIL: unrelated educator can see the reviewed time entry';
  end if;
end $$;

rollback;
select 'PASS: educator clock-out, admin approval, educator status and private routed decision alert' as result;
