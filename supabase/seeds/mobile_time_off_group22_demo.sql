-- Group 22 demo data: Maria sees approved, declined and pending decisions.
-- Re-runnable and intentionally isolated to deterministic IDs.

do $$
declare
  v_member_id uuid;
  v_daycare_id uuid;
  v_admin_id uuid;
  v_today date;
begin
  select member.id, member.daycare_id
    into v_member_id, v_daycare_id
    from public.staff_members member
    join public.profiles profile on profile.id = member.profile_id
   where lower(profile.email) = 'maria@sunnygrove.test'
     and member.status = 'active'
     and member.archived_at is null
   limit 1;

  if v_member_id is null then
    raise exception 'Maria Kowalski seed staff record was not found';
  end if;

  select profile.id
    into v_admin_id
    from public.profiles profile
   where profile.daycare_id = v_daycare_id
     and profile.role in ('owner_admin', 'admin')
     and profile.archived_at is null
   order by case when profile.role = 'owner_admin' then 0 else 1 end, profile.created_at
   limit 1;

  v_today := public.center_today();

  -- The two approved weekdays below plus the prior Group 17 demo approval
  -- leave a useful, non-zero balance in the Group 22 list.
  update public.staff_members
     set annual_paid_leave_days = 16
   where id = v_member_id;

  insert into public.staff_time_off_requests (
    id, daycare_id, staff_member_id, starts_on, ends_on, kind, status,
    reason, decision_notes, reviewed_by, reviewed_at, created_at, updated_at
  ) values
    (
      '54300000-0000-4000-a000-000000000001', v_daycare_id, v_member_id,
      v_today + 10, v_today + 11, 'personal', 'approved',
      'Two family appointments out of town.',
      'Approved — Grace will cover Preschool both days.',
      v_admin_id, now() - interval '1 day', now() - interval '2 days', now() - interval '1 day'
    ),
    (
      '54300000-0000-4000-a000-000000000002', v_daycare_id, v_member_id,
      v_today - 5, v_today - 1, 'vacation', 'declined',
      'Family trip booked during the summer break.',
      'We are short-staffed that week. Could you try the week after? I can approve those dates.',
      v_admin_id, now() - interval '24 days', now() - interval '26 days', now() - interval '24 days'
    ),
    (
      '54300000-0000-4000-a000-000000000003', v_daycare_id, v_member_id,
      v_today + 32, v_today + 32, 'other', 'pending',
      'Medical appointment at 2:00 PM.',
      null, null, null, now() - interval '1 day', now() - interval '1 day'
    )
  on conflict (id) do update set
    daycare_id = excluded.daycare_id,
    staff_member_id = excluded.staff_member_id,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    kind = excluded.kind,
    status = excluded.status,
    reason = excluded.reason,
    decision_notes = excluded.decision_notes,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    replaces_request_id = null;
end;
$$;
