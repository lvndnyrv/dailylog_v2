-- ============================================================================
-- DailyLog — row-level security (Phase 0)
-- ============================================================================
-- Deny-by-default: RLS is enabled on every table and no permissive catch-alls
-- exist. Role model (design/PHASE_0_FOUNDATION.md §3):
--   owner_admin/admin — full access within their daycare
--   educator          — read daycare children/classrooms; write logs,
--                       attendance, incidents for assigned classrooms only
--   parent            — read ONLY linked children's data (via parent_children);
--                       write own consents/absences/messages/RSVPs
-- Helpers (is_admin, can_access_child, can_write_child, …) are defined in
-- 20260716000200_functions.sql. Smoke tests: supabase/tests/rls_smoke_test.sql
-- ============================================================================

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'daycares', 'classrooms', 'profiles', 'educator_classrooms',
    'staff_members', 'staff_invites', 'daycare_signup_codes',
    'children', 'parent_children', 'child_invite_codes', 'enrollments',
    'daily_logs', 'meal_entries', 'diaper_entries', 'sleep_entries',
    'activity_entries', 'supply_requests', 'photos',
    'attendance_records', 'incident_reports',
    'medication_authorizations', 'medication_logs', 'consents',
    'conversations', 'messages', 'announcements', 'announcement_rsvps',
    'billing_plans', 'invoices', 'invoice_lines', 'payments', 'statements',
    'documents', 'notifications', 'push_tokens', 'audit_log', 'app_config'
  ]
  loop
    execute format('alter table %I enable row level security', tbl);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- daycares
-- ─────────────────────────────────────────────────────────────────────────────

create policy "members read own daycare" on daycares
  for select using (
    id = get_my_daycare_id()
    -- parents may have no daycare_id on their profile; they reach the daycare
    -- through their children
    or id in (select c.daycare_id from children c where c.id in (select my_child_ids()))
  );

-- onboarding: any authed user can create a daycare, then becomes its admin
create policy "authed users create daycares" on daycares
  for insert with check (auth.uid() is not null and created_by = auth.uid());

create policy "creator reads own new daycare" on daycares
  for select using (created_by = auth.uid());

create policy "admins update own daycare" on daycares
  for update using (is_admin() and id = get_my_daycare_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- classrooms
-- ─────────────────────────────────────────────────────────────────────────────

create policy "staff read daycare classrooms" on classrooms
  for select using (is_staff() and daycare_id = get_my_daycare_id());

create policy "parents read linked classrooms" on classrooms
  for select using (
    id in (select c.classroom_id from children c where c.id in (select my_child_ids()))
  );

create policy "admins manage classrooms" on classrooms
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────────────────────────────────────

create policy "users read own profile" on profiles
  for select using (id = auth.uid());

create policy "staff read daycare profiles" on profiles
  for select using (is_staff() and daycare_id = get_my_daycare_id());

-- parents can see names of staff who write to their children's logs/messages
create policy "parents read staff profiles" on profiles
  for select using (
    get_my_role() = 'parent'
    and role in ('owner_admin', 'admin', 'educator')
    and daycare_id in (select c.daycare_id from children c where c.id in (select my_child_ids()))
  );

create policy "users update own profile" on profiles
  for update using (id = auth.uid())
  -- role/daycare changes go through RPCs (admin_set_user_role, join_daycare_with_code)
  with check (
    id = auth.uid()
    and role = (select p.role from profiles p where p.id = auth.uid())
    and daycare_id is not distinct from (select p.daycare_id from profiles p where p.id = auth.uid())
  );

create policy "admins update daycare profiles" on profiles
  for update using (is_admin() and daycare_id = get_my_daycare_id());

-- inserts happen via the handle_new_user trigger (security definer); no policy

-- ─────────────────────────────────────────────────────────────────────────────
-- educator_classrooms · staff_members · invites · codes
-- ─────────────────────────────────────────────────────────────────────────────

create policy "staff read educator assignments" on educator_classrooms
  for select using (
    educator_id = auth.uid()
    or (is_admin() and classroom_id in
        (select id from classrooms where daycare_id = get_my_daycare_id()))
  );

create policy "admins manage educator assignments" on educator_classrooms
  for all using (
    is_admin() and classroom_id in
      (select id from classrooms where daycare_id = get_my_daycare_id())
  )
  with check (
    is_admin() and classroom_id in
      (select id from classrooms where daycare_id = get_my_daycare_id())
  );

create policy "staff read own record, admins all" on staff_members
  for select using (
    profile_id = auth.uid()
    or (is_admin() and daycare_id = get_my_daycare_id())
  );

create policy "admins manage staff records" on staff_members
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "admins manage staff invites" on staff_invites
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "admins manage signup codes" on daycare_signup_codes
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());
-- unauthenticated lookup goes through check_daycare_signup_code (definer)

-- ─────────────────────────────────────────────────────────────────────────────
-- children · parent_children · child_invite_codes
-- ─────────────────────────────────────────────────────────────────────────────

-- Staff read the whole center's children (roster views — PHASE_0 §3:
-- "educators: read center children/rooms"); writes stay room-scoped below.
-- Parents come through can_access_child (linked children only).
create policy "read children by access" on children
  for select using (
    (is_staff() and daycare_id = get_my_daycare_id())
    or can_access_child(id)
  );

create policy "staff write children" on children
  for insert with check (
    is_admin() and daycare_id = get_my_daycare_id()
    or (get_my_role() = 'educator' and classroom_id in (select my_classroom_ids()))
  );

create policy "staff update children" on children
  for update using (can_write_child(id));

-- no delete policy: children are archived (archived_at), never hard-deleted

create policy "parents read own links" on parent_children
  for select using (parent_id = auth.uid());

create policy "staff read daycare links" on parent_children
  for select using (
    is_staff() and child_id in
      (select id from children where daycare_id = get_my_daycare_id())
  );

create policy "parents update own consent" on parent_children
  for update using (parent_id = auth.uid())
  with check (parent_id = auth.uid());

create policy "admins manage links" on parent_children
  for all using (
    is_admin() and child_id in
      (select id from children where daycare_id = get_my_daycare_id())
  )
  with check (
    is_admin() and child_id in
      (select id from children where daycare_id = get_my_daycare_id())
  );
-- parent self-links happen via link_child_with_code (definer)

create policy "staff manage child invite codes" on child_invite_codes
  for all using (
    (is_admin() or can_write_child(child_id)) and daycare_id = get_my_daycare_id()
  )
  with check (
    (is_admin() or can_write_child(child_id)) and daycare_id = get_my_daycare_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- enrollments (admin-only pipeline; public inquiry form is a Phase 5 edge fn)
-- ─────────────────────────────────────────────────────────────────────────────

create policy "admins manage enrollments" on enrollments
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- daily_logs + entry tables + photos
-- ─────────────────────────────────────────────────────────────────────────────

create policy "read logs by child access" on daily_logs
  for select using (can_access_child(child_id));

create policy "staff create logs" on daily_logs
  for insert with check (can_write_child(child_id));

create policy "staff update logs" on daily_logs
  for update using (can_write_child(child_id));

create policy "staff delete logs" on daily_logs
  for delete using (can_write_child(child_id));

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'meal_entries', 'diaper_entries', 'sleep_entries',
    'activity_entries', 'supply_requests', 'photos'
  ]
  loop
    execute format('
      create policy "read entries by log access" on %I
        for select using (can_access_log(daily_log_id));
      create policy "staff create entries" on %I
        for insert with check (can_write_log(daily_log_id));
      create policy "staff update entries" on %I
        for update using (can_write_log(daily_log_id));
      create policy "staff delete entries" on %I
        for delete using (can_write_log(daily_log_id));
    ', tbl, tbl, tbl, tbl);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- attendance
-- ─────────────────────────────────────────────────────────────────────────────

create policy "read attendance by child access" on attendance_records
  for select using (can_access_child(child_id));

create policy "staff write attendance" on attendance_records
  for insert with check (can_write_child(child_id));

create policy "staff update attendance" on attendance_records
  for update using (can_write_child(child_id));

-- parents can report an absence for their own child (design 8e)
create policy "parents report absence" on attendance_records
  for insert with check (
    get_my_role() = 'parent'
    and child_id in (select my_child_ids())
    and status in ('absent', 'excused')
    and checked_in_at is null
    and checked_out_at is null
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- incidents
-- ─────────────────────────────────────────────────────────────────────────────

create policy "read incidents by child access" on incident_reports
  for select using (can_access_child(child_id));

create policy "staff create incidents" on incident_reports
  for insert with check (can_write_child(child_id));

create policy "author updates own draft, admins any" on incident_reports
  for update using (
    (educator_id = auth.uid() and status in ('draft', 'submitted'))
    or (is_admin() and daycare_id = get_my_daycare_id())
  );
-- parent acknowledgment goes through acknowledge_incident (definer)

-- ─────────────────────────────────────────────────────────────────────────────
-- medications
-- ─────────────────────────────────────────────────────────────────────────────

create policy "read med auths by child access" on medication_authorizations
  for select using (can_access_child(child_id));

create policy "parents authorize own child meds" on medication_authorizations
  for insert with check (
    get_my_role() = 'parent'
    and parent_id = auth.uid()
    and child_id in (select my_child_ids())
  );

create policy "parents update own auths, staff any" on medication_authorizations
  for update using (
    (parent_id = auth.uid() and child_id in (select my_child_ids()))
    or can_write_child(child_id)
  );

create policy "read med logs by child access" on medication_logs
  for select using (can_access_child(child_id));

create policy "staff log doses" on medication_logs
  for insert with check (
    can_write_child(child_id) and administered_by = auth.uid()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- consents
-- ─────────────────────────────────────────────────────────────────────────────

create policy "read consents by child access" on consents
  for select using (can_access_child(child_id));

create policy "parents write own child consents" on consents
  for insert with check (
    get_my_role() = 'parent'
    and parent_id = auth.uid()
    and child_id in (select my_child_ids())
  );

create policy "parents update own child consents" on consents
  for update using (
    get_my_role() = 'parent'
    and parent_id = auth.uid()
    and child_id in (select my_child_ids())
  );

create policy "admins manage consents" on consents
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- conversations · messages
-- ─────────────────────────────────────────────────────────────────────────────

create policy "read conversations by child access" on conversations
  for select using (
    (child_id is not null and can_access_child(child_id))
    or (child_id is null and is_staff() and daycare_id = get_my_daycare_id())
  );

create policy "participants create conversations" on conversations
  for insert with check (
    (child_id is not null and can_access_child(child_id))
    or (child_id is null and is_staff() and daycare_id = get_my_daycare_id())
  );

create policy "staff update conversations" on conversations
  for update using (is_staff() and daycare_id = get_my_daycare_id());

create policy "read messages by child access" on messages
  for select using (
    (child_id is not null and can_access_child(child_id))
    or (child_id is null and conversation_id in (select id from conversations))
  );

create policy "send messages as self" on messages
  for insert with check (
    sender_id = auth.uid()
    and (
      (child_id is not null and can_access_child(child_id))
      or (child_id is null and conversation_id in (select id from conversations))
    )
  );
-- read receipts go through mark_messages_read (definer)

-- ─────────────────────────────────────────────────────────────────────────────
-- announcements · RSVPs
-- ─────────────────────────────────────────────────────────────────────────────

create policy "members read announcements" on announcements
  for select using (
    (is_staff() and daycare_id = get_my_daycare_id())
    or (
      get_my_role() = 'parent'
      and daycare_id in (select c.daycare_id from children c where c.id in (select my_child_ids()))
      and (
        classroom_id is null
        or classroom_id in (select c.classroom_id from children c where c.id in (select my_child_ids()))
      )
    )
  );

create policy "staff create announcements" on announcements
  for insert with check (
    is_staff() and daycare_id = get_my_daycare_id() and author_id = auth.uid()
  );

create policy "author or admin updates announcements" on announcements
  for update using (
    (author_id = auth.uid() or is_admin()) and daycare_id = get_my_daycare_id()
  );

create policy "author or admin deletes announcements" on announcements
  for delete using (
    (author_id = auth.uid() or is_admin()) and daycare_id = get_my_daycare_id()
  );

create policy "read rsvps on visible announcements" on announcement_rsvps
  for select using (
    profile_id = auth.uid()
    or (is_staff() and daycare_id = get_my_daycare_id())
  );

create policy "users manage own rsvps" on announcement_rsvps
  for all using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and announcement_id in (select id from announcements)  -- must be visible to them
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- billing (admin-writes; parents read their own)
-- ─────────────────────────────────────────────────────────────────────────────

create policy "admins manage billing plans" on billing_plans
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "admins manage invoices" on invoices
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "parents read own invoices" on invoices
  for select using (billed_to = auth.uid());

create policy "admins manage invoice lines" on invoice_lines
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "parents read own invoice lines" on invoice_lines
  for select using (
    invoice_id in (select id from invoices where billed_to = auth.uid())
  );

create policy "admins manage payments" on payments
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "parents read own payments" on payments
  for select using (paid_by = auth.uid());

create policy "admins manage statements" on statements
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "parents read own child statements" on statements
  for select using (child_id in (select my_child_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- documents · notifications · push tokens · audit · config
-- ─────────────────────────────────────────────────────────────────────────────

create policy "read documents by subject access" on documents
  for select using (
    (is_admin() and daycare_id = get_my_daycare_id())
    or (child_id is not null and can_access_child(child_id))
    or profile_id = auth.uid()
  );

create policy "staff upload documents" on documents
  for insert with check (
    is_staff() and daycare_id = get_my_daycare_id() and uploaded_by = auth.uid()
  );

create policy "admins manage documents" on documents
  for update using (is_admin() and daycare_id = get_my_daycare_id());

create policy "users read own notifications" on notifications
  for select using (profile_id = auth.uid());

create policy "users mark own notifications read" on notifications
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
-- notification inserts come from definer functions / service jobs only

create policy "users manage own push tokens" on push_tokens
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "admins read audit log" on audit_log
  for select using (is_admin() and daycare_id = get_my_daycare_id());
-- audit writes come from definer functions only

create policy "authed users read app config" on app_config
  for select using (auth.uid() is not null);
-- app_config writes: service role only (no policy)

-- ─────────────────────────────────────────────────────────────────────────────
-- storage buckets + policies
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public) values
  ('child-avatars', 'child-avatars', false),
  ('incident-photos', 'incident-photos', false),
  ('daily-log-photos', 'daily-log-photos', false),
  ('documents', 'documents', false)
on conflict (id) do nothing;

-- object names are "<child_id>/<file>"; storage_child_id() extracts the uuid
create policy "staff write child avatars" on storage.objects
  for insert with check (
    bucket_id = 'child-avatars' and can_write_child(storage_child_id(name))
  );

create policy "staff update child avatars" on storage.objects
  for update using (
    bucket_id = 'child-avatars' and can_write_child(storage_child_id(name))
  );

create policy "staff delete child avatars" on storage.objects
  for delete using (
    bucket_id = 'child-avatars' and can_write_child(storage_child_id(name))
  );

create policy "read child avatars by access" on storage.objects
  for select using (
    bucket_id = 'child-avatars' and can_access_child(storage_child_id(name))
  );

create policy "staff write incident photos" on storage.objects
  for insert with check (
    bucket_id = 'incident-photos' and can_write_child(storage_child_id(name))
  );

create policy "read incident photos by access" on storage.objects
  for select using (
    bucket_id = 'incident-photos' and can_access_child(storage_child_id(name))
  );

create policy "staff write log photos" on storage.objects
  for insert with check (
    bucket_id = 'daily-log-photos' and can_write_child(storage_child_id(name))
  );

create policy "read log photos by access" on storage.objects
  for select using (
    bucket_id = 'daily-log-photos' and can_access_child(storage_child_id(name))
  );

create policy "staff write documents bucket" on storage.objects
  for insert with check (
    bucket_id = 'documents' and is_staff()
  );

create policy "admins read documents bucket" on storage.objects
  for select using (
    bucket_id = 'documents' and is_admin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- realtime
-- ─────────────────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table daily_logs;
alter publication supabase_realtime add table meal_entries;
alter publication supabase_realtime add table diaper_entries;
alter publication supabase_realtime add table sleep_entries;
alter publication supabase_realtime add table activity_entries;
alter publication supabase_realtime add table supply_requests;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table notifications;
