-- ============================================================
-- DailyLog — Admin Full-Access Permissions
-- ============================================================
-- Gives admin role the same CRUD permissions as educators across
-- all operational tables (children, daily_logs, entry tables,
-- attendance, parent_children, classrooms, incident_reports, storage).
--
-- Admin = daycare owner/director who manages everything.
-- Run AFTER supabase-phase0-reconciliation.sql.
-- ============================================================

-- ─────────────────────────────────────────────
-- CHILDREN: admin can insert, update, delete in their daycare
-- ─────────────────────────────────────────────

drop policy if exists "Admins can add children" on children;
create policy "Admins can add children"
  on children for insert
  with check (
    get_my_role() = 'admin'
    and classroom_id in (select id from classrooms where daycare_id = get_my_daycare_id())
  );

drop policy if exists "Admins can update children" on children;
create policy "Admins can update children"
  on children for update
  using (
    get_my_role() = 'admin'
    and classroom_id in (select id from classrooms where daycare_id = get_my_daycare_id())
  );

drop policy if exists "Admins can delete children" on children;
create policy "Admins can delete children"
  on children for delete
  using (
    get_my_role() = 'admin'
    and classroom_id in (select id from classrooms where daycare_id = get_my_daycare_id())
  );

-- ─────────────────────────────────────────────
-- DAILY LOGS: admin can read, create, update
-- ─────────────────────────────────────────────

drop policy if exists "Admins read daycare logs" on daily_logs;
create policy "Admins read daycare logs"
  on daily_logs for select
  using (
    get_my_role() = 'admin'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

drop policy if exists "Admins create logs" on daily_logs;
create policy "Admins create logs"
  on daily_logs for insert
  with check (
    get_my_role() = 'admin'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

drop policy if exists "Admins update logs" on daily_logs;
create policy "Admins update logs"
  on daily_logs for update
  using (
    get_my_role() = 'admin'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

-- ─────────────────────────────────────────────
-- ENTRY TABLES: admin CRUD via can_access_log
-- (can_access_log already handles educator+parent, add admin)
-- ─────────────────────────────────────────────

-- Redefine can_access_log to also support admin role
create or replace function can_access_log(log_id uuid)
returns boolean as $$
  select exists(
    select 1 from daily_logs dl
    join children c on c.id = dl.child_id
    join classrooms cl on cl.id = c.classroom_id
    where dl.id = log_id
    and (
      (get_my_role() = 'educator' and cl.daycare_id = get_my_daycare_id())
      or
      (get_my_role() = 'admin' and cl.daycare_id = get_my_daycare_id())
      or
      (get_my_role() = 'parent' and c.id in (
        select child_id from parent_children where parent_id = auth.uid()
      ))
    )
  )
$$ language sql security definer stable;

-- Admin-specific policies for entry tables
do $$
declare
  tbl text;
begin
  for tbl in select unnest(array['meal_entries','diaper_entries','sleep_entries','activity_entries','supply_requests'])
  loop
    execute format('drop policy if exists "Admins can insert %1$s" on %1$s', tbl);
    execute format('create policy "Admins can insert %1$s" on %1$s for insert with check (get_my_role() = ''admin'' and can_access_log(daily_log_id))', tbl);

    execute format('drop policy if exists "Admins can update %1$s" on %1$s', tbl);
    execute format('create policy "Admins can update %1$s" on %1$s for update using (get_my_role() = ''admin'' and can_access_log(daily_log_id))', tbl);

    execute format('drop policy if exists "Admins can delete %1$s" on %1$s', tbl);
    execute format('create policy "Admins can delete %1$s" on %1$s for delete using (get_my_role() = ''admin'' and can_access_log(daily_log_id))', tbl);

    execute format('drop policy if exists "Admins can read %1$s" on %1$s', tbl);
    execute format('create policy "Admins can read %1$s" on %1$s for select using (get_my_role() = ''admin'' and can_access_log(daily_log_id))', tbl);
  end loop;
end;
$$;

-- ─────────────────────────────────────────────
-- ATTENDANCE: admin can manage attendance
-- ─────────────────────────────────────────────

drop policy if exists "Admins can read attendance" on attendance_records;
create policy "Admins can read attendance"
  on attendance_records for select
  using (
    get_my_role() = 'admin'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

drop policy if exists "Admins can insert attendance" on attendance_records;
create policy "Admins can insert attendance"
  on attendance_records for insert
  with check (
    get_my_role() = 'admin'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

drop policy if exists "Admins can update attendance" on attendance_records;
create policy "Admins can update attendance"
  on attendance_records for update
  using (
    get_my_role() = 'admin'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

-- ─────────────────────────────────────────────
-- PARENT_CHILDREN: admin can link/unlink parents
-- NOTE: SELECT policy must NOT query children table directly
-- because children has a policy that queries parent_children → recursion.
-- We use a security definer function to bypass RLS in the check.
-- ─────────────────────────────────────────────

-- Helper: checks if child belongs to admin's daycare (bypasses RLS)
create or replace function child_in_my_daycare(p_child_id uuid)
returns boolean as $$
  select exists(
    select 1 from children c
    join classrooms cl on cl.id = c.classroom_id
    where c.id = p_child_id
    and cl.daycare_id = (select daycare_id from profiles where id = auth.uid())
  )
$$ language sql security definer stable;

drop policy if exists "Admins can link parents" on parent_children;
create policy "Admins can link parents"
  on parent_children for insert
  with check (
    get_my_role() = 'admin'
    and child_in_my_daycare(child_id)
  );

drop policy if exists "Admins can unlink parents" on parent_children;
create policy "Admins can unlink parents"
  on parent_children for delete
  using (
    get_my_role() = 'admin'
    and child_in_my_daycare(child_id)
  );

drop policy if exists "Admins can view parent links" on parent_children;
create policy "Admins can view parent links"
  on parent_children for select
  using (
    get_my_role() = 'admin'
    and child_in_my_daycare(child_id)
  );

-- ─────────────────────────────────────────────
-- CLASSROOMS: admin can create, update, delete
-- ─────────────────────────────────────────────

drop policy if exists "Admins can create classrooms" on classrooms;
create policy "Admins can create classrooms"
  on classrooms for insert
  with check (get_my_role() = 'admin' and daycare_id = get_my_daycare_id());

drop policy if exists "Admins can update classrooms" on classrooms;
create policy "Admins can update classrooms"
  on classrooms for update
  using (get_my_role() = 'admin' and daycare_id = get_my_daycare_id());

drop policy if exists "Admins can delete classrooms" on classrooms;
create policy "Admins can delete classrooms"
  on classrooms for delete
  using (get_my_role() = 'admin' and daycare_id = get_my_daycare_id());

-- ─────────────────────────────────────────────
-- INCIDENT REPORTS: admin can insert, view, update
-- ─────────────────────────────────────────────

drop policy if exists "Admins can insert incidents" on incident_reports;
create policy "Admins can insert incidents"
  on incident_reports for insert
  with check (
    get_my_role() = 'admin'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

drop policy if exists "Admins can view incidents" on incident_reports;
create policy "Admins can view incidents"
  on incident_reports for select
  using (
    get_my_role() = 'admin'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

drop policy if exists "Admins can update incidents" on incident_reports;
create policy "Admins can update incidents"
  on incident_reports for update
  using (
    get_my_role() = 'admin'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

-- ─────────────────────────────────────────────
-- STORAGE: admin can upload/view/delete photos
-- ─────────────────────────────────────────────

-- Redefine can_access_child to include admin
create or replace function can_access_child(p_child_id uuid)
returns boolean as $$
  select exists(
    select 1 from children c
    join classrooms cl on cl.id = c.classroom_id
    where c.id = p_child_id
    and (
      (get_my_role() = 'educator' and cl.daycare_id = get_my_daycare_id())
      or
      (get_my_role() = 'admin' and cl.daycare_id = get_my_daycare_id())
      or
      (get_my_role() = 'parent' and c.id in (
        select child_id from parent_children where parent_id = auth.uid()
      ))
    )
  )
$$ language sql security definer stable;

-- Storage policies already use can_access_child(), so redefining it
-- above gives admin automatic access to all 3 storage buckets.
-- For INSERT policies that check get_my_role() = 'educator', add admin:

-- incident-photos: admin upload
drop policy if exists "Admins can upload incident photos" on storage.objects;
create policy "Admins can upload incident photos"
  on storage.objects for insert
  with check (
    bucket_id = 'incident-photos'
    and get_my_role() = 'admin'
    and can_access_child(storage_child_id(name))
  );

drop policy if exists "Admins can delete incident photos" on storage.objects;
create policy "Admins can delete incident photos"
  on storage.objects for delete
  using (
    bucket_id = 'incident-photos'
    and get_my_role() = 'admin'
    and can_access_child(storage_child_id(name))
  );

-- child-avatars: admin upload/update/delete
drop policy if exists "Admins can upload child avatars" on storage.objects;
create policy "Admins can upload child avatars"
  on storage.objects for insert
  with check (
    bucket_id = 'child-avatars'
    and get_my_role() = 'admin'
    and can_access_child(storage_child_id(name))
  );

drop policy if exists "Admins can update child avatars" on storage.objects;
create policy "Admins can update child avatars"
  on storage.objects for update
  using (
    bucket_id = 'child-avatars'
    and get_my_role() = 'admin'
    and can_access_child(storage_child_id(name))
  );

drop policy if exists "Admins can delete child avatars" on storage.objects;
create policy "Admins can delete child avatars"
  on storage.objects for delete
  using (
    bucket_id = 'child-avatars'
    and get_my_role() = 'admin'
    and can_access_child(storage_child_id(name))
  );

-- daily-log-photos: admin upload/delete
drop policy if exists "Admins upload daily log photos" on storage.objects;
create policy "Admins upload daily log photos"
  on storage.objects for insert
  with check (
    bucket_id = 'daily-log-photos'
    and get_my_role() = 'admin'
    and can_access_child(storage_child_id(name))
  );

drop policy if exists "Admins delete daily log photos" on storage.objects;
create policy "Admins delete daily log photos"
  on storage.objects for delete
  using (
    bucket_id = 'daily-log-photos'
    and get_my_role() = 'admin'
    and can_access_child(storage_child_id(name))
  );

-- NOTE: daily_log_photos table does not exist in current schema.
-- Photos are stored directly in the daily-log-photos storage bucket.
-- Admin access to that bucket is handled by the storage policies above.

-- ─────────────────────────────────────────────
-- MESSAGES: admin can read/send messages
-- (messages are scoped by child_id, not receiver_id)
-- ─────────────────────────────────────────────

drop policy if exists "Admins can read messages" on messages;
create policy "Admins can read messages"
  on messages for select
  using (
    get_my_role() = 'admin'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

drop policy if exists "Admins can send messages" on messages;
create policy "Admins can send messages"
  on messages for insert
  with check (
    get_my_role() = 'admin'
    and sender_id = auth.uid()
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

-- ─────────────────────────────────────────────
-- EDUCATOR_CLASSROOMS: admin can manage educator assignments
-- ─────────────────────────────────────────────

drop policy if exists "Admins can view educator assignments" on educator_classrooms;
create policy "Admins can view educator assignments"
  on educator_classrooms for select
  using (
    get_my_role() = 'admin'
    and classroom_id in (select id from classrooms where daycare_id = get_my_daycare_id())
  );

drop policy if exists "Admins can assign educators" on educator_classrooms;
create policy "Admins can assign educators"
  on educator_classrooms for insert
  with check (
    get_my_role() = 'admin'
    and classroom_id in (select id from classrooms where daycare_id = get_my_daycare_id())
  );

drop policy if exists "Admins can remove educator assignments" on educator_classrooms;
create policy "Admins can remove educator assignments"
  on educator_classrooms for delete
  using (
    get_my_role() = 'admin'
    and classroom_id in (select id from classrooms where daycare_id = get_my_daycare_id())
  );




