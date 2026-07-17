-- ============================================================================
-- DailyLog — audit fixes: server-assigned roles, hot-path FK indexes
-- ============================================================================

-- Roles are never client-claimed. The public signup API let callers write
-- role='owner_admin' into their metadata; every legitimate elevation already
-- goes through a definer RPC (accept_staff_invite, start_center,
-- admin_set_user_role, join_daycare_with_code) — so the trigger now always
-- starts everyone as 'parent'.
create or replace function handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'parent'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- FK indexes on the paths queries actually take (joins, RLS subqueries,
-- cascade deletes). The remaining unindexed FKs are cold write-side columns.
create index if not exists profiles_classroom_idx on profiles (classroom_id) where classroom_id is not null;
create index if not exists educator_classrooms_classroom_idx on educator_classrooms (classroom_id);
create index if not exists staff_members_profile_idx on staff_members (profile_id);
create index if not exists staff_invites_daycare_idx on staff_invites (daycare_id) where accepted_at is null;
create index if not exists child_invite_codes_child_idx on child_invite_codes (child_id) where used_at is null;
create index if not exists conversations_child_idx on conversations (child_id) where archived_at is null;
create index if not exists messages_sender_idx on messages (sender_id);
create index if not exists invoices_child_idx on invoices (child_id);
create index if not exists invoices_billed_to_idx on invoices (billed_to);
create index if not exists payments_daycare_paid_at_idx on payments (daycare_id, paid_at desc);
create index if not exists announcements_classroom_idx on announcements (classroom_id) where classroom_id is not null;
create index if not exists medication_auth_parent_idx on medication_authorizations (parent_id);
create index if not exists daily_logs_educator_idx on daily_logs (educator_id);
create index if not exists audit_log_actor_idx on audit_log (actor_id);
