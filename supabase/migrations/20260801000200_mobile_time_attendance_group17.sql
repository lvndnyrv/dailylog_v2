-- ==========================================================================
-- Mobile Group 17 — educator time attendance and time-off requests
-- ==========================================================================

alter table public.staff_members
  add column if not exists annual_paid_leave_days integer not null default 10;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'staff_members_annual_paid_leave_days_check'
       and conrelid = 'public.staff_members'::regclass
  ) then
    alter table public.staff_members
      add constraint staff_members_annual_paid_leave_days_check
      check (annual_paid_leave_days between 0 and 365);
  end if;
end;
$$;

alter table public.staff_time_off_requests
  drop constraint if exists staff_time_off_requests_kind_check;

alter table public.staff_time_off_requests
  add constraint staff_time_off_requests_kind_check
  check (kind in ('vacation', 'sick', 'personal', 'unpaid', 'other'));

create or replace function public.request_time_off(
  p_starts_on date,
  p_ends_on date,
  p_kind text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.staff_members%rowtype;
  v_request_id uuid;
  v_today date := public.center_today();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_member
    from public.staff_members
   where id = public.my_staff_member_id()
     and profile_id = auth.uid()
     and status = 'active'
     and archived_at is null;

  if v_member.id is null then
    raise exception 'Active staff record required';
  end if;

  if p_starts_on is null or p_ends_on is null then
    raise exception 'Start and end dates are required';
  end if;

  if p_starts_on < v_today or p_ends_on < p_starts_on then
    raise exception 'Choose a valid current or future date range';
  end if;

  if p_ends_on - p_starts_on > 62 then
    raise exception 'A single request cannot exceed 63 days';
  end if;

  if p_kind not in ('vacation', 'sick', 'personal', 'unpaid', 'other') then
    raise exception 'Unsupported time-off type';
  end if;

  if length(coalesce(p_reason, '')) > 500 then
    raise exception 'The note must be 500 characters or fewer';
  end if;

  if exists (
    select 1
      from public.staff_time_off_requests r
     where r.staff_member_id = v_member.id
       and r.status in ('pending', 'approved')
       and daterange(r.starts_on, r.ends_on, '[]')
           && daterange(p_starts_on, p_ends_on, '[]')
  ) then
    raise exception 'This request overlaps existing time off';
  end if;

  insert into public.staff_time_off_requests (
    daycare_id,
    staff_member_id,
    starts_on,
    ends_on,
    kind,
    status,
    reason
  ) values (
    v_member.daycare_id,
    v_member.id,
    p_starts_on,
    p_ends_on,
    p_kind,
    'pending',
    nullif(trim(p_reason), '')
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.request_time_off(date, date, text, text) from public;
grant execute on function public.request_time_off(date, date, text, text) to authenticated;

comment on function public.request_time_off(date, date, text, text) is
  'Creates a validated time-off request for the signed-in active staff member.';

notify pgrst, 'reload schema';
