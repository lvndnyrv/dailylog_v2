-- ============================================================
-- DailyLog — Phase 2 Security Hardening Migration
-- ============================================================
-- Fixes audit finding 4.3:
--   A. Storage objects readable by ANY authenticated user → scoped to
--      the child's daycare educators + linked parents.
--   B. Incident INSERT only checked role → now requires the child to be
--      in the educator's daycare, and educator_id = auth.uid().
--   C. Parents could UPDATE any incident column (incl. description) →
--      replaced with a column-safe acknowledge_incident() RPC.
--   D. Entry-table access (can_access_log) pinned to the educator's
--      single active classroom → daycare-wide (multi-classroom fix).
--   E. NEW: privilege-escalation holes closed with column-level grants
--      (profiles.role self-promotion, parent_children.child_id rebinding,
--      messages body tampering via UPDATE).
--
-- Run AFTER supabase-phase0-reconciliation.sql. Idempotent.
-- ============================================================

-- ─────────────────────────────────────────────
-- A. STORAGE READ/WRITE SCOPING
-- ─────────────────────────────────────────────
-- All three buckets use paths starting with the child id:
--   child-avatars:     {childId}/avatar_*.jpg
--   incident-photos:   {childId}/{incidentId}/*.jpg
--   daily-log-photos:  {childId}/{logId}/*.jpg

-- Safe cast of the first path segment to a child uuid
create or replace function storage_child_id(object_name text)
returns uuid
language plpgsql stable
as $$
begin
  return ((storage.foldername(object_name))[1])::uuid;
exception when others then
  return null;
end;
$$;

-- can_access_child() (from Phase 0) checks:
--   educator → child's classroom is in my daycare
--   parent   → child is linked to me
-- can_access_child(null) → false, so malformed paths are denied.

-- — incident-photos —
drop policy if exists "Authenticated users can view incident photos" on storage.objects;
create policy "Linked users view incident photos"
  on storage.objects for select
  using (bucket_id = 'incident-photos' and can_access_child(storage_child_id(name)));

drop policy if exists "Educators can upload incident photos" on storage.objects;
create policy "Educators can upload incident photos"
  on storage.objects for insert
  with check (
    bucket_id = 'incident-photos'
    and get_my_role() = 'educator'
    and can_access_child(storage_child_id(name))
  );

drop policy if exists "Educators can delete incident photos" on storage.objects;
create policy "Educators can delete incident photos"
  on storage.objects for delete
  using (
    bucket_id = 'incident-photos'
    and get_my_role() = 'educator'
    and can_access_child(storage_child_id(name))
  );

-- — child-avatars —
drop policy if exists "Authenticated users can view child avatars" on storage.objects;
create policy "Linked users view child avatars"
  on storage.objects for select
  using (bucket_id = 'child-avatars' and can_access_child(storage_child_id(name)));

drop policy if exists "Educators can upload child avatars" on storage.objects;
create policy "Educators can upload child avatars"
  on storage.objects for insert
  with check (
    bucket_id = 'child-avatars'
    and get_my_role() = 'educator'
    and can_access_child(storage_child_id(name))
  );

drop policy if exists "Educators can update child avatars" on storage.objects;
create policy "Educators can update child avatars"
  on storage.objects for update
  using (
    bucket_id = 'child-avatars'
    and get_my_role() = 'educator'
    and can_access_child(storage_child_id(name))
  );

drop policy if exists "Educators can delete child avatars" on storage.objects;
create policy "Educators can delete child avatars"
  on storage.objects for delete
  using (
    bucket_id = 'child-avatars'
    and get_my_role() = 'educator'
    and can_access_child(storage_child_id(name))
  );

-- — daily-log-photos (tighten the Phase 0 educator-wide policies) —
drop policy if exists "Educators upload daily log photos" on storage.objects;
create policy "Educators upload daily log photos"
  on storage.objects for insert
  with check (
    bucket_id = 'daily-log-photos'
    and get_my_role() = 'educator'
    and can_access_child(storage_child_id(name))
  );

drop policy if exists "Educators delete daily log photos" on storage.objects;
create policy "Educators delete daily log photos"
  on storage.objects for delete
  using (
    bucket_id = 'daily-log-photos'
    and get_my_role() = 'educator'
    and can_access_child(storage_child_id(name))
  );

drop policy if exists "Linked users view daily log photos" on storage.objects;
create policy "Linked users view daily log photos"
  on storage.objects for select
  using (bucket_id = 'daily-log-photos' and can_access_child(storage_child_id(name)));

-- ─────────────────────────────────────────────
-- B. INCIDENT REPORTS — daycare-scoped writes
-- ─────────────────────────────────────────────

drop policy if exists "Educators can insert incidents" on incident_reports;
create policy "Educators can insert incidents"
  on incident_reports for insert
  with check (
    get_my_role() = 'educator'
    and educator_id = auth.uid()
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

-- Broaden educator visibility from single active classroom → daycare
drop policy if exists "Educators can view classroom incidents" on incident_reports;
create policy "Educators can view daycare incidents"
  on incident_reports for select
  using (
    get_my_role() = 'educator'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

-- ─────────────────────────────────────────────
-- C. COLUMN-SAFE PARENT ACKNOWLEDGMENT (RPC)
-- ─────────────────────────────────────────────
-- Parents no longer get UPDATE on incident_reports at all.

drop policy if exists "Parents can acknowledge incidents" on incident_reports;

create or replace function acknowledge_incident(p_incident_id uuid, p_full_name text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_child uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Full name is required to acknowledge';
  end if;

  select child_id into v_child from incident_reports where id = p_incident_id;
  if v_child is null then
    raise exception 'Incident not found';
  end if;

  -- Caller must be a parent linked to this child
  if not exists (
    select 1 from parent_children
    where parent_id = auth.uid() and child_id = v_child
  ) then
    raise exception 'Not authorized to acknowledge this incident';
  end if;

  update incident_reports
  set status = 'acknowledged',
      parent_acknowledged_at = now(),
      parent_acknowledge_name = trim(p_full_name)
  where id = p_incident_id
    and status = 'submitted'; -- only submitted reports can be acknowledged
end;
$$;

-- ─────────────────────────────────────────────
-- D. MULTI-CLASSROOM FIX for entry tables & photos
-- ─────────────────────────────────────────────
-- can_access_log() gates meal/diaper/sleep/activity/supply entries AND the
-- photos table. Redefining it here fixes them all at once: educators keep
-- access to every classroom in their daycare (not just the "active" one).

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
      (get_my_role() = 'parent' and c.id in (
        select child_id from parent_children where parent_id = auth.uid()
      ))
    )
  )
$$ language sql security definer stable;

-- ─────────────────────────────────────────────
-- E. PRIVILEGE-ESCALATION FIXES (column-level grants)
-- ─────────────────────────────────────────────
-- RLS row policies can't restrict columns; combine them with column grants.

-- E1. profiles: "Users can update own profile" allowed updating `role`
--     (parent → educator/admin self-promotion) and `email`. Restrict to
--     the columns the app legitimately edits.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone, daycare_id, classroom_id)
  on public.profiles to authenticated;

-- E2. parent_children: "Parents can update consent" allowed rewriting
--     child_id (self-linking to an arbitrary child!). Consent column only.
revoke update on public.parent_children from authenticated, anon;
grant update (consent_given_at) on public.parent_children to authenticated;

-- E3. messages: participants could UPDATE message bodies. read_at only.
--     (Add column first so the grant doesn't fail.)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_at timestamptz DEFAULT NULL;
revoke update on public.messages from authenticated, anon;
grant update (read_at) on public.messages to authenticated;

