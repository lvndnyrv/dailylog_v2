-- ============================================================================
-- DailyLog — Phase 5: enrollment pipeline (2b/2d/2g), settings closures (11c)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Public inquiry form (2g): anonymous families submit through definer RPCs —
-- the center id in the shared link scopes everything; nothing else is readable.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function get_public_center_info(p_daycare_id uuid)
returns table (name text, programs jsonb)
language sql security definer stable
set search_path = public
as $$
  select d.name,
         coalesce(
           (select jsonb_agg(jsonb_build_object('id', cl.id, 'name', cl.name)
                             order by cl.min_age_months nulls last)
              from classrooms cl
             where cl.daycare_id = d.id and cl.archived_at is null),
           '[]'::jsonb)
  from daycares d
  where d.id = p_daycare_id and d.active
$$;

create or replace function submit_enrollment_inquiry(
  p_daycare_id uuid,
  p_guardian_name text,
  p_guardian_email text,
  p_guardian_phone text,
  p_child_first_name text,
  p_child_date_of_birth date,
  p_classroom_id uuid default null,
  p_desired_start date default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (select 1 from daycares where id = p_daycare_id and active) then
    raise exception 'Unknown center';
  end if;
  if coalesce(trim(p_guardian_name), '') = '' or coalesce(trim(p_guardian_email), '') = '' then
    raise exception 'Name and email are required';
  end if;

  insert into enrollments (daycare_id, classroom_id, child_first_name,
                           child_date_of_birth, guardian_name, guardian_email,
                           guardian_phone, stage, desired_start_date, source)
  values (p_daycare_id, p_classroom_id, trim(p_child_first_name),
          p_child_date_of_birth, trim(p_guardian_name), lower(trim(p_guardian_email)),
          nullif(trim(p_guardian_phone), ''), 'inquiry', p_desired_start, 'website');
end;
$$;

-- Enrolling from the pipeline creates the child record atomically (2f).
create or replace function enroll_from_pipeline(
  p_enrollment_id uuid,
  p_classroom_id uuid,
  p_last_name text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_enrollment enrollments%rowtype;
  v_child uuid;
begin
  if not is_admin() then
    raise exception 'Only admins can enroll';
  end if;

  select * into v_enrollment from enrollments
   where id = p_enrollment_id and daycare_id = get_my_daycare_id();
  if v_enrollment.id is null then
    raise exception 'Enrollment not found';
  end if;
  if v_enrollment.stage in ('enrolled', 'withdrawn') then
    raise exception 'Already %', v_enrollment.stage;
  end if;

  insert into children (daycare_id, classroom_id, first_name, last_name,
                        date_of_birth, enrolled_on)
  values (v_enrollment.daycare_id, p_classroom_id,
          coalesce(v_enrollment.child_first_name, 'New'),
          coalesce(nullif(trim(p_last_name), ''),
                   nullif(split_part(v_enrollment.guardian_name, ' ', 2), ''),
                   'Family'),
          v_enrollment.child_date_of_birth,
          coalesce(v_enrollment.desired_start_date, current_date))
  returning id into v_child;

  update enrollments
     set stage = 'enrolled', child_id = v_child, classroom_id = p_classroom_id,
         stage_changed_at = now()
   where id = v_enrollment.id;

  return v_child;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Center closures (11c) — holidays and planned closure days
-- ─────────────────────────────────────────────────────────────────────────────

create table center_closures (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text not null,
  created_at timestamptz default now()
);

alter table center_closures enable row level security;

create policy "members read closures" on center_closures
  for select using (
    daycare_id = get_my_daycare_id()
    or daycare_id in (select c.daycare_id from children c
                       where c.id in (select my_child_ids()))
  );

create policy "admins manage closures" on center_closures
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());
