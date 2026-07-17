-- ============================================================================
-- P0 — staff schedules, clock-ins, timesheets, and time off
-- ============================================================================

alter table daycares
  add column if not exists time_tracking_enabled boolean not null default false;

-- Older centers can have staff profiles without an employment row. Timekeeping
-- uses staff_members as its stable subject, so reconcile those rows first.
insert into staff_members (daycare_id, profile_id, job_title, status)
select p.daycare_id, p.id,
       case when p.role = 'owner_admin' then 'Owner administrator'
            when p.role = 'admin' then 'Administrator'
            else 'Educator' end,
       'active'
  from profiles p
 where p.daycare_id is not null
   and p.role in ('owner_admin', 'admin', 'educator')
   and not exists (
     select 1 from staff_members sm
      where sm.daycare_id = p.daycare_id and sm.profile_id = p.id
   );

create table staff_shifts (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  classroom_id uuid references classrooms(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  unpaid_break_minutes int not null default 0 check (unpaid_break_minutes between 0 and 720),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'cancelled', 'completed')),
  notes text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (unpaid_break_minutes < extract(epoch from (ends_at - starts_at)) / 60)
);

create index staff_shifts_center_range_idx on staff_shifts (daycare_id, starts_at, ends_at);
create index staff_shifts_member_range_idx on staff_shifts (staff_member_id, starts_at, ends_at);

create table staff_time_entries (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  shift_id uuid references staff_shifts(id) on delete set null,
  classroom_id uuid references classrooms(id) on delete set null,
  clocked_in_at timestamptz not null,
  clocked_out_at timestamptz,
  break_minutes int not null default 0 check (break_minutes between 0 and 720),
  source text not null default 'mobile' check (source in ('mobile', 'kiosk', 'manual')),
  status text not null default 'open'
    check (status in ('open', 'submitted', 'approved', 'rejected')),
  notes text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (clocked_out_at is null or clocked_out_at > clocked_in_at),
  check ((status = 'open') = (clocked_out_at is null))
);

create unique index staff_time_entries_one_open_idx
  on staff_time_entries (staff_member_id) where clocked_out_at is null;
create index staff_time_entries_center_range_idx
  on staff_time_entries (daycare_id, clocked_in_at, clocked_out_at);
create index staff_time_entries_member_range_idx
  on staff_time_entries (staff_member_id, clocked_in_at);

create table staff_time_off_requests (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  kind text not null default 'vacation' check (kind in ('vacation', 'sick', 'unpaid', 'other')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'cancelled')),
  reason text,
  decision_notes text,
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index staff_time_off_center_range_idx
  on staff_time_off_requests (daycare_id, starts_on, ends_on);
create index staff_time_off_member_range_idx
  on staff_time_off_requests (staff_member_id, starts_on, ends_on);

create trigger staff_shifts_updated_at before update on staff_shifts
  for each row execute function update_updated_at();
create trigger staff_time_entries_updated_at before update on staff_time_entries
  for each row execute function update_updated_at();
create trigger staff_time_off_updated_at before update on staff_time_off_requests
  for each row execute function update_updated_at();

alter table staff_shifts enable row level security;
alter table staff_time_entries enable row level security;
alter table staff_time_off_requests enable row level security;

create or replace function my_staff_member_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select id from staff_members
   where profile_id = auth.uid() and status = 'active' and archived_at is null
   limit 1
$$;

create policy "staff read own published shifts" on staff_shifts
  for select using (
    (staff_member_id = my_staff_member_id() and status <> 'draft')
    or (is_admin() and daycare_id = get_my_daycare_id())
  );
create policy "admins manage shifts" on staff_shifts
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "staff read own time entries" on staff_time_entries
  for select using (
    staff_member_id = my_staff_member_id()
    or (is_admin() and daycare_id = get_my_daycare_id())
  );
create policy "staff create own time entries" on staff_time_entries
  for insert with check (
    staff_member_id = my_staff_member_id() and daycare_id = get_my_daycare_id()
  );
create policy "staff update own unapproved time entries" on staff_time_entries
  for update using (
    staff_member_id = my_staff_member_id() and status in ('open', 'submitted', 'rejected')
  ) with check (
    staff_member_id = my_staff_member_id() and daycare_id = get_my_daycare_id()
      and status in ('open', 'submitted')
  );
create policy "admins manage center time entries" on staff_time_entries
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "staff read own time off" on staff_time_off_requests
  for select using (
    staff_member_id = my_staff_member_id()
    or (is_admin() and daycare_id = get_my_daycare_id())
  );
create policy "staff request own time off" on staff_time_off_requests
  for insert with check (
    staff_member_id = my_staff_member_id() and daycare_id = get_my_daycare_id()
  );
create policy "staff update own pending time off" on staff_time_off_requests
  for update using (
    staff_member_id = my_staff_member_id() and status = 'pending'
  ) with check (
    staff_member_id = my_staff_member_id() and daycare_id = get_my_daycare_id()
      and status in ('pending', 'cancelled')
  );
create policy "admins manage center time off" on staff_time_off_requests
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create or replace function clock_in(
  p_classroom_id uuid default null,
  p_at timestamptz default now()
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_member staff_members%rowtype;
  v_shift uuid;
  v_classroom uuid;
  v_entry uuid;
begin
  select * into v_member from staff_members
   where id = my_staff_member_id();
  if v_member.id is null then
    raise exception 'Active staff record required';
  end if;
  if exists (select 1 from staff_time_entries where staff_member_id = v_member.id and clocked_out_at is null) then
    raise exception 'Already clocked in';
  end if;
  if p_at > now() + interval '5 minutes' or p_at < now() - interval '24 hours' then
    raise exception 'Clock-in time is outside the allowed window';
  end if;
  if p_classroom_id is not null and not exists (
    select 1 from classrooms c
     where c.id = p_classroom_id and c.daycare_id = v_member.daycare_id and c.archived_at is null
  ) then
    raise exception 'Classroom not found';
  end if;
  if get_my_role() = 'educator' and p_classroom_id is not null
     and p_classroom_id not in (select my_classroom_ids()) then
    raise exception 'Not assigned to this classroom';
  end if;

  select s.id, s.classroom_id into v_shift, v_classroom
    from staff_shifts s
   where s.staff_member_id = v_member.id
     and s.status = 'published'
     and p_at between s.starts_at - interval '2 hours' and s.ends_at + interval '2 hours'
   order by abs(extract(epoch from (p_at - s.starts_at)))
   limit 1;

  v_classroom := coalesce(p_classroom_id, v_classroom, get_my_classroom_id());
  insert into staff_time_entries (
    daycare_id, staff_member_id, shift_id, classroom_id, clocked_in_at, source, status
  ) values (
    v_member.daycare_id, v_member.id, v_shift, v_classroom, p_at, 'mobile', 'open'
  ) returning id into v_entry;
  return v_entry;
end;
$$;

create or replace function clock_out(
  p_at timestamptz default now(),
  p_break_minutes int default 0
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_entry staff_time_entries%rowtype;
begin
  select * into v_entry from staff_time_entries
   where staff_member_id = my_staff_member_id() and clocked_out_at is null
   for update;
  if v_entry.id is null then
    raise exception 'No open clock-in found';
  end if;
  if p_at <= v_entry.clocked_in_at or p_at > now() + interval '5 minutes' then
    raise exception 'Invalid clock-out time';
  end if;
  if coalesce(p_break_minutes, 0) < 0
     or coalesce(p_break_minutes, 0) >= extract(epoch from (p_at - v_entry.clocked_in_at)) / 60 then
    raise exception 'Invalid break duration';
  end if;

  update staff_time_entries
     set clocked_out_at = p_at,
         break_minutes = coalesce(p_break_minutes, 0),
         status = 'submitted'
   where id = v_entry.id;
  return v_entry.id;
end;
$$;

create or replace function approve_time_entry(p_entry_id uuid, p_approved boolean, p_notes text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admin access required'; end if;
  update staff_time_entries
     set status = case when p_approved then 'approved' else 'rejected' end,
         approved_by = auth.uid(), approved_at = now(), notes = coalesce(p_notes, notes)
   where id = p_entry_id and daycare_id = get_my_daycare_id()
     and clocked_out_at is not null and status in ('submitted', 'rejected');
  if not found then raise exception 'Time entry not found or not reviewable'; end if;
end;
$$;

-- Once enabled, live ratios use actual open time entries. Centers can prepare
-- schedules and train staff before flipping this switch.
create or replace function get_rooms_live_status()
returns table (
  id uuid, name text, age_group text, min_age_months int, max_age_months int,
  capacity int, ratio_children_per_educator int, enrolled_count bigint,
  present_count bigint, last_log_at timestamptz, educators jsonb
)
language sql security definer stable
set search_path = public
as $$
  select cl.id, cl.name, cl.age_group, cl.min_age_months, cl.max_age_months,
         cl.capacity, cl.ratio_children_per_educator,
         (select count(*) from children c where c.classroom_id = cl.id and c.archived_at is null),
         (select count(*) from attendance_records ar
           join children c on c.id = ar.child_id
          where c.classroom_id = cl.id and ar.date = center_today()
            and ar.checked_in_at is not null and ar.checked_out_at is null),
         (select max(coalesce(dl.updated_at, dl.created_at)) from daily_logs dl
           join children c on c.id = dl.child_id
          where c.classroom_id = cl.id and dl.log_date = center_today()),
         case when (select time_tracking_enabled from daycares where id = cl.daycare_id)
           then coalesce((
             select jsonb_agg(jsonb_build_object('id', present.id, 'full_name', present.full_name)
                              order by present.full_name)
             from (
               select distinct p.id, p.full_name
                 from staff_time_entries te
                 join staff_members sm on sm.id = te.staff_member_id
                 join profiles p on p.id = sm.profile_id
                where te.daycare_id = cl.daycare_id and te.clocked_out_at is null
                  and (te.classroom_id = cl.id or (
                    te.classroom_id is null and (
                      p.classroom_id = cl.id or exists (
                        select 1 from educator_classrooms ec
                         where ec.educator_id = p.id and ec.classroom_id = cl.id
                      )
                    )
                  ))
             ) present
           ), '[]'::jsonb)
           else coalesce((
             select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name)
                              order by p.full_name)
               from profiles p
              where p.role = 'educator' and p.archived_at is null
                and (p.classroom_id = cl.id or exists (
                  select 1 from educator_classrooms ec
                   where ec.classroom_id = cl.id and ec.educator_id = p.id
                ))
           ), '[]'::jsonb)
         end
    from classrooms cl
   where cl.daycare_id = get_my_daycare_id() and cl.archived_at is null and is_staff()
   order by cl.min_age_months nulls last, cl.name
$$;

grant execute on function clock_in(uuid, timestamptz) to authenticated;
grant execute on function clock_out(timestamptz, int) to authenticated;
grant execute on function approve_time_entry(uuid, boolean, text) to authenticated;

drop trigger if exists audit_staff_shifts on staff_shifts;
create trigger audit_staff_shifts after insert or update or delete on staff_shifts
  for each row execute function audit_write();
drop trigger if exists audit_staff_time_entries on staff_time_entries;
create trigger audit_staff_time_entries after insert or update on staff_time_entries
  for each row execute function audit_write();
drop trigger if exists audit_staff_time_off on staff_time_off_requests;
create trigger audit_staff_time_off after insert or update on staff_time_off_requests
  for each row execute function audit_write();
