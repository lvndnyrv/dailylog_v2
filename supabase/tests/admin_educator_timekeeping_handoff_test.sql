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
  v_correction_entry uuid;
  v_correction_start timestamptz := date_trunc('day', now()) - interval '90 days' + interval '9 hours';
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
       and notification.payload ->> 'clockedAt' is not null
  ) then
    raise exception 'FAIL: approval did not create a routed educator alert';
  end if;
  if not exists (
    select 1 from public.notification_outbox delivery
     where delivery.recipient_id = v_educator
       and delivery.channel = 'push'
       and delivery.kind = 'timesheet_review'
       and delivery.payload ->> 'entryId' = v_entry::text
       and delivery.payload ->> 'clockedAt' is not null
       and delivery.dedupe_key = 'timesheet-review:' || v_entry::text || ':approved'
  ) then
    raise exception 'FAIL: approval did not enqueue a durable educator push';
  end if;

  perform pg_temp.impersonate('postgres');
  insert into public.staff_time_entries (
    daycare_id, staff_member_id, clocked_in_at, clocked_out_at,
    break_minutes, source, status
  )
  select member.daycare_id, member.id, v_correction_start,
         v_correction_start + interval '8 hours', 30, 'mobile', 'submitted'
    from public.staff_members member
   where member.id = v_member
  returning id into v_correction_entry;

  perform pg_temp.impersonate('authenticated', v_owner);
  perform public.approve_time_entry(v_correction_entry, false, 'Clock-in should be 9:05.');

  perform pg_temp.impersonate('authenticated', v_educator);
  perform public.resubmit_time_entry_correction(
    v_correction_entry,
    v_correction_start + interval '5 minutes',
    v_correction_start + interval '8 hours',
    30
  );
  if not exists (
    select 1 from public.staff_time_entries entry
     where entry.id = v_correction_entry
       and entry.status = 'submitted'
       and entry.clocked_in_at = v_correction_start + interval '5 minutes'
       and entry.approved_by is null
       and entry.approved_at is null
       and entry.notes = 'Clock-in should be 9:05.'
  ) then
    raise exception 'FAIL: educator correction did not return to admin review';
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
