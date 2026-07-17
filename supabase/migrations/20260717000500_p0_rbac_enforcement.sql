-- ============================================================================
-- P0 — enforce center_roles.permissions at the database boundary
-- ============================================================================

create or replace function has_permission(p_area text, p_action text default 'view')
returns boolean
language plpgsql security definer stable
set search_path = public
as $$
declare
  v_role text;
  v_permissions jsonb;
  v_value text;
begin
  if p_area not in (
    'daily_logs', 'attendance', 'medications', 'incidents', 'children',
    'enrollment', 'broadcasts', 'billing', 'reports', 'staff'
  ) or p_action not in ('view', 'edit', 'approve') then
    return false;
  end if;

  select p.role, r.permissions into v_role, v_permissions
    from profiles p
    left join center_roles r on r.id = p.center_role_id and r.daycare_id = p.daycare_id
   where p.id = auth.uid();

  if v_role = 'owner_admin' then return true; end if;
  v_value := v_permissions #>> array[p_area, p_action];
  if v_value in ('true', 'false') then return v_value::boolean; end if;

  -- Safe compatibility fallback for rows created before the role library.
  if v_role = 'admin' then return true; end if;
  if v_role = 'educator' then
    if p_action = 'view' then
      return p_area in ('daily_logs', 'attendance', 'medications', 'incidents', 'children', 'broadcasts');
    elsif p_action = 'edit' then
      return p_area in ('daily_logs', 'attendance', 'medications', 'incidents');
    end if;
  end if;
  return false;
end;
$$;

-- Every future center needs the same locked/default library that existing
-- centers received during the role-library backfill.
create or replace function seed_center_roles_on_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform seed_default_roles(new.id);
  return new;
end;
$$;
drop trigger if exists seed_center_roles_after_insert on daycares;
create trigger seed_center_roles_after_insert after insert on daycares
  for each row execute function seed_center_roles_on_insert();
revoke all on function seed_default_roles(uuid) from public, anon, authenticated;
grant execute on function seed_default_roles(uuid) to service_role;

create or replace function can_access_child_area(
  p_child_id uuid,
  p_area text,
  p_action text default 'view'
)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select case
    when get_my_role() = 'parent' then
      p_action = 'view' and p_child_id in (select my_child_ids())
    when is_staff() then
      has_permission(p_area, p_action)
      and exists (
        select 1 from children c
         where c.id = p_child_id and c.daycare_id = get_my_daycare_id()
           and (
             -- The center roster is intentionally center-wide for educators.
             (p_area = 'children' and p_action = 'view')
             or can_access_child(c.id)
           )
      )
    else false
  end
$$;

create or replace function can_access_log_area(
  p_log_id uuid,
  p_action text default 'view'
)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from daily_logs dl
     where dl.id = p_log_id
       and can_access_child_area(dl.child_id, 'daily_logs', p_action)
  )
$$;

create or replace function can_access_billing_family(p_family_id uuid, p_action text default 'view')
returns boolean
language sql security definer stable
set search_path = public
as $$
  select case
    when get_my_role() = 'parent' then exists (
      select 1 from family_members fm
       where fm.family_id = p_family_id and fm.profile_id = auth.uid()
    )
    when is_staff() then has_permission('billing', p_action) and exists (
      select 1 from families f
       where f.id = p_family_id and f.daycare_id = get_my_daycare_id()
    )
    else false
  end
$$;

-- A general family lookup is needed by child profiles, billing, and messaging.
-- Staff need at least one of those capabilities; parents still need membership.
create or replace function can_access_family(p_family_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from families f
     where f.id = p_family_id
       and (
         exists (select 1 from family_members fm
                  where fm.family_id = f.id and fm.profile_id = auth.uid())
         or (
           is_staff() and f.daycare_id = get_my_daycare_id()
           and (has_permission('children', 'view')
                or has_permission('billing', 'view')
                or has_permission('broadcasts', 'view'))
         )
       )
  )
$$;

create or replace function can_message_family(p_family_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from families f
     where f.id = p_family_id
       and (
         exists (select 1 from family_members fm
                  where fm.family_id = f.id and fm.profile_id = auth.uid()
                    and fm.receives_messages)
         or (
           is_staff() and has_permission('broadcasts', 'view')
           and f.daycare_id = get_my_daycare_id()
           and (
             get_my_role() in ('owner_admin', 'admin')
             or exists (
               select 1 from family_children fc
               join children c on c.id = fc.child_id
                where fc.family_id = f.id and c.classroom_id in (select my_classroom_ids())
             )
           )
         )
       )
  )
$$;

-- ── Children and households ─────────────────────────────────────────────────
drop policy if exists "read children by access" on children;
drop policy if exists "staff write children" on children;
drop policy if exists "staff update children" on children;
create policy "read children by area access" on children for select
  using (can_access_child_area(id, 'children', 'view'));
create policy "staff create children with permission" on children for insert
  with check (
    has_permission('children', 'edit') and daycare_id = get_my_daycare_id()
    and (get_my_role() in ('owner_admin', 'admin') or classroom_id in (select my_classroom_ids()))
  );
create policy "staff update children with permission" on children for update
  using (has_permission('children', 'edit') and can_write_child(id))
  with check (has_permission('children', 'edit') and daycare_id = get_my_daycare_id());

drop policy if exists "staff read daycare links" on parent_children;
drop policy if exists "admins manage links" on parent_children;
create policy "permitted staff read daycare links" on parent_children for select
  using (has_permission('children', 'view') and child_id in (
    select id from children where daycare_id = get_my_daycare_id()
  ));
create policy "permitted staff manage links" on parent_children for all
  using (has_permission('children', 'edit') and child_id in (
    select id from children where daycare_id = get_my_daycare_id()
  ))
  with check (has_permission('children', 'edit') and child_id in (
    select id from children where daycare_id = get_my_daycare_id()
  ));

drop policy if exists "staff manage child invite codes" on child_invite_codes;
create policy "permitted staff manage child invite codes" on child_invite_codes for all
  using (has_permission('children', 'edit') and can_write_child(child_id))
  with check (has_permission('children', 'edit') and can_write_child(child_id));

drop policy if exists "read pickups by child access" on child_pickups;
drop policy if exists "staff manage pickups" on child_pickups;
create policy "read pickups by permitted child access" on child_pickups for select
  using (can_access_child_area(child_id, 'children', 'view'));
create policy "permitted staff manage pickups" on child_pickups for all
  using (has_permission('children', 'edit') and can_write_child(child_id))
  with check (has_permission('children', 'edit') and can_write_child(child_id)
    and daycare_id = get_my_daycare_id());

create or replace function enforce_child_admin_mutation()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'child_invite_codes' and tg_op = 'UPDATE'
     and old.used_at is null and new.used_at is not null and new.used_by = auth.uid() then
    return new;
  end if;
  if not has_permission('children', 'edit') then raise exception 'Children edit permission required'; end if;
  return coalesce(new, old);
end;
$$;
create trigger enforce_child_invite_admin before insert or update or delete on child_invite_codes
  for each row execute function enforce_child_admin_mutation();
create trigger enforce_child_pickup_admin before insert or update or delete on child_pickups
  for each row execute function enforce_child_admin_mutation();

drop policy if exists "admins manage center families" on families;
drop policy if exists "admins manage family members" on family_members;
drop policy if exists "admins manage family children" on family_children;
create policy "permitted staff manage center families" on families for all
  using (has_permission('children', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('children', 'edit') and daycare_id = get_my_daycare_id());
create policy "permitted staff manage family members" on family_members for all
  using (has_permission('children', 'edit') and family_id in (
    select id from families where daycare_id = get_my_daycare_id()
  ))
  with check (has_permission('children', 'edit') and family_id in (
    select id from families where daycare_id = get_my_daycare_id()
  ));
create policy "permitted staff manage family children" on family_children for all
  using (has_permission('children', 'edit') and family_id in (
    select id from families where daycare_id = get_my_daycare_id()
  ))
  with check (has_permission('children', 'edit') and family_id in (
    select id from families where daycare_id = get_my_daycare_id()
  ));

-- ── Care records ─────────────────────────────────────────────────────────────
drop policy if exists "read logs by child access" on daily_logs;
drop policy if exists "staff create logs" on daily_logs;
drop policy if exists "staff update logs" on daily_logs;
drop policy if exists "staff delete logs" on daily_logs;
create policy "read logs by area access" on daily_logs for select
  using (can_access_child_area(child_id, 'daily_logs', 'view'));
create policy "permitted staff create logs" on daily_logs for insert
  with check (has_permission('daily_logs', 'edit') and can_write_child(child_id));
create policy "permitted staff update logs" on daily_logs for update
  using (has_permission('daily_logs', 'edit') and can_write_child(child_id));
create policy "permitted staff delete logs" on daily_logs for delete
  using (has_permission('daily_logs', 'edit') and can_write_child(child_id));

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'meal_entries', 'diaper_entries', 'sleep_entries',
    'activity_entries', 'supply_requests', 'photos'
  ] loop
    execute format('drop policy if exists "read entries by log access" on %I', tbl);
    execute format('drop policy if exists "staff create entries" on %I', tbl);
    execute format('drop policy if exists "staff update entries" on %I', tbl);
    execute format('drop policy if exists "staff delete entries" on %I', tbl);
    execute format('create policy "read entries by permitted log access" on %I for select using (can_access_log_area(daily_log_id, ''view''))', tbl);
    execute format('create policy "permitted staff create entries" on %I for insert with check (can_access_log_area(daily_log_id, ''edit''))', tbl);
    execute format('create policy "permitted staff update entries" on %I for update using (can_access_log_area(daily_log_id, ''edit''))', tbl);
    execute format('create policy "permitted staff delete entries" on %I for delete using (can_access_log_area(daily_log_id, ''edit''))', tbl);
  end loop;
end $$;

drop policy if exists "read attendance by child access" on attendance_records;
drop policy if exists "staff write attendance" on attendance_records;
drop policy if exists "staff update attendance" on attendance_records;
create policy "read attendance by area access" on attendance_records for select
  using (can_access_child_area(child_id, 'attendance', 'view'));
create policy "permitted staff write attendance" on attendance_records for insert
  with check (has_permission('attendance', 'edit') and can_write_child(child_id));
create policy "permitted staff update attendance" on attendance_records for update
  using (has_permission('attendance', 'edit') and can_write_child(child_id));

drop policy if exists "read incidents by child access" on incident_reports;
drop policy if exists "staff create incidents" on incident_reports;
drop policy if exists "author updates own draft, admins any" on incident_reports;
create policy "read incidents by area access" on incident_reports for select
  using (can_access_child_area(child_id, 'incidents', 'view'));
create policy "permitted staff create incidents" on incident_reports for insert
  with check (has_permission('incidents', 'edit') and can_write_child(child_id));
create policy "permitted staff update incidents" on incident_reports for update
  using (
    has_permission('incidents', 'edit') and can_write_child(child_id)
    and (educator_id = auth.uid() or has_permission('incidents', 'approve'))
  );

create or replace function enforce_incident_status_permission()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  if get_my_role() = 'parent' and new.child_id in (select my_child_ids())
     and new.status = 'acknowledged' then return new; end if;
  if new.status = 'signed_off' and old.status is distinct from 'signed_off'
     and not has_permission('incidents', 'approve') then
    raise exception 'Incident approval permission required';
  end if;
  if not has_permission('incidents', 'edit') then raise exception 'Incident edit permission required'; end if;
  return new;
end;
$$;
create trigger enforce_incident_status before update on incident_reports
  for each row execute function enforce_incident_status_permission();

drop policy if exists "read med auths by child access" on medication_authorizations;
drop policy if exists "parents update own auths, staff any" on medication_authorizations;
drop policy if exists "read med logs by child access" on medication_logs;
drop policy if exists "staff log doses" on medication_logs;
create policy "read medication auths by area access" on medication_authorizations for select
  using (can_access_child_area(child_id, 'medications', 'view'));
create policy "parents or permitted staff update medication auths" on medication_authorizations for update
  using (
    (parent_id = auth.uid() and child_id in (select my_child_ids()))
    or (has_permission('medications', 'edit') and can_write_child(child_id))
  );
create policy "read medication logs by area access" on medication_logs for select
  using (can_access_child_area(child_id, 'medications', 'view'));
create policy "permitted staff log doses" on medication_logs for insert
  with check (
    has_permission('medications', 'edit') and can_write_child(child_id)
    and administered_by = auth.uid()
  );

-- ── Enrollment and broadcasts ────────────────────────────────────────────────
drop policy if exists "admins manage enrollments" on enrollments;
create policy "permitted staff read enrollments" on enrollments for select
  using (has_permission('enrollment', 'view') and daycare_id = get_my_daycare_id());
create policy "permitted staff manage enrollments" on enrollments for all
  using (has_permission('enrollment', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('enrollment', 'edit') and daycare_id = get_my_daycare_id());

create or replace function enforce_enrollment_mutation()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.source = 'website' and new.stage = 'inquiry'
     and new.child_id is null then return new; end if;
  if not has_permission('enrollment', 'edit') then raise exception 'Enrollment edit permission required'; end if;
  return coalesce(new, old);
end;
$$;
create trigger enforce_enrollment_admin before insert or update or delete on enrollments
  for each row execute function enforce_enrollment_mutation();

drop policy if exists "members read announcements" on announcements;
drop policy if exists "staff create announcements" on announcements;
drop policy if exists "author or admin updates announcements" on announcements;
drop policy if exists "author or admin deletes announcements" on announcements;
create policy "members read permitted announcements" on announcements for select using (
  (is_staff() and has_permission('broadcasts', 'view') and daycare_id = get_my_daycare_id())
  or (
    get_my_role() = 'parent'
    and daycare_id in (select c.daycare_id from children c where c.id in (select my_child_ids()))
    and (classroom_id is null or classroom_id in (
      select c.classroom_id from children c where c.id in (select my_child_ids())
    ))
  )
);
create policy "permitted staff create announcements" on announcements for insert
  with check (has_permission('broadcasts', 'edit') and daycare_id = get_my_daycare_id() and author_id = auth.uid());
create policy "permitted staff update announcements" on announcements for update
  using (has_permission('broadcasts', 'edit') and daycare_id = get_my_daycare_id()
    and (author_id = auth.uid() or has_permission('broadcasts', 'approve')));
create policy "permitted staff delete announcements" on announcements for delete
  using (has_permission('broadcasts', 'edit') and daycare_id = get_my_daycare_id()
    and (author_id = auth.uid() or has_permission('broadcasts', 'approve')));

-- ── Billing and ledger ───────────────────────────────────────────────────────
drop policy if exists "admins manage billing plans" on billing_plans;
drop policy if exists "admins manage invoices" on invoices;
drop policy if exists "admins manage invoice lines" on invoice_lines;
drop policy if exists "admins manage payments" on payments;
drop policy if exists "admins manage statements" on statements;
create policy "permitted staff manage billing plans" on billing_plans for all
  using (has_permission('billing', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('billing', 'edit') and daycare_id = get_my_daycare_id());
create policy "permitted staff manage invoices" on invoices for all
  using (has_permission('billing', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('billing', 'edit') and daycare_id = get_my_daycare_id());
create policy "permitted staff manage invoice lines" on invoice_lines for all
  using (has_permission('billing', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('billing', 'edit') and daycare_id = get_my_daycare_id());
create policy "permitted staff manage payments" on payments for all
  using (has_permission('billing', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('billing', 'edit') and daycare_id = get_my_daycare_id());
create policy "permitted staff manage statements" on statements for all
  using (has_permission('billing', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('billing', 'edit') and daycare_id = get_my_daycare_id());

drop policy if exists "members read family ledger account" on family_ledger_accounts;
drop policy if exists "members read family ledger entries" on family_ledger_entries;
drop policy if exists "members read family payment allocations" on payment_allocations;
create policy "permitted members read family ledger account" on family_ledger_accounts for select
  using (can_access_billing_family(family_id, 'view'));
create policy "permitted members read family ledger entries" on family_ledger_entries for select
  using (can_access_billing_family(family_id, 'view'));
create policy "permitted members read family payment allocations" on payment_allocations for select
  using (can_access_billing_family(family_id, 'view'));

-- Definer billing RPCs still pass through this trigger, closing the usual RLS
-- bypass hole while preserving service-role gateway adapters.
create or replace function enforce_billing_edit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return coalesce(new, old);
  end if;
  if not has_permission('billing', 'edit') then raise exception 'Billing edit permission required'; end if;
  return coalesce(new, old);
end;
$$;

create trigger enforce_billing_plans_edit before insert or update or delete on billing_plans
  for each row execute function enforce_billing_edit();
create trigger enforce_invoices_edit before insert or update or delete on invoices
  for each row execute function enforce_billing_edit();
create trigger enforce_invoice_lines_edit before insert or update or delete on invoice_lines
  for each row execute function enforce_billing_edit();
create trigger enforce_payments_edit before insert or update or delete on payments
  for each row execute function enforce_billing_edit();
create trigger enforce_statements_edit before insert or update or delete on statements
  for each row execute function enforce_billing_edit();
create trigger enforce_ledger_entries_edit before insert on family_ledger_entries
  for each row execute function enforce_billing_edit();

-- ── Staff administration and timekeeping ────────────────────────────────────
drop policy if exists "staff read own record, admins all" on staff_members;
drop policy if exists "admins manage staff records" on staff_members;
drop policy if exists "admins manage staff invites" on staff_invites;
drop policy if exists "admins manage signup codes" on daycare_signup_codes;
drop policy if exists "staff read educator assignments" on educator_classrooms;
drop policy if exists "admins manage educator assignments" on educator_classrooms;
create policy "staff read own or permitted records" on staff_members for select
  using (profile_id = auth.uid() or (has_permission('staff', 'view') and daycare_id = get_my_daycare_id()));
create policy "permitted staff manage records" on staff_members for all
  using (has_permission('staff', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('staff', 'edit') and daycare_id = get_my_daycare_id());
create policy "permitted staff manage invites" on staff_invites for all
  using (has_permission('staff', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('staff', 'edit') and daycare_id = get_my_daycare_id());
create policy "permitted staff manage signup codes" on daycare_signup_codes for all
  using (has_permission('staff', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('staff', 'edit') and daycare_id = get_my_daycare_id());
create policy "permitted staff read educator assignments" on educator_classrooms for select using (
  educator_id = auth.uid() or has_permission('staff', 'view')
);
create policy "permitted staff manage educator assignments" on educator_classrooms for all using (
  has_permission('staff', 'edit') and classroom_id in (
    select id from classrooms where daycare_id = get_my_daycare_id()
  )
) with check (
  has_permission('staff', 'edit') and classroom_id in (
    select id from classrooms where daycare_id = get_my_daycare_id()
  )
);

drop policy if exists "admins manage shifts" on staff_shifts;
drop policy if exists "admins manage center time entries" on staff_time_entries;
drop policy if exists "admins manage center time off" on staff_time_off_requests;
drop policy if exists "staff read own published shifts" on staff_shifts;
drop policy if exists "staff read own time entries" on staff_time_entries;
drop policy if exists "staff read own time off" on staff_time_off_requests;
create policy "staff read own or permitted shifts" on staff_shifts for select
  using (
    (staff_member_id = my_staff_member_id() and status <> 'draft')
    or (has_permission('staff', 'view') and daycare_id = get_my_daycare_id())
  );
create policy "staff read own or permitted time entries" on staff_time_entries for select
  using (
    staff_member_id = my_staff_member_id()
    or (has_permission('staff', 'view') and daycare_id = get_my_daycare_id())
  );
create policy "staff read own or permitted time off" on staff_time_off_requests for select
  using (
    staff_member_id = my_staff_member_id()
    or (has_permission('staff', 'view') and daycare_id = get_my_daycare_id())
  );
create policy "permitted staff manage shifts" on staff_shifts for all
  using (has_permission('staff', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('staff', 'edit') and daycare_id = get_my_daycare_id());
create policy "permitted staff manage center time entries" on staff_time_entries for all
  using (has_permission('staff', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('staff', 'edit') and daycare_id = get_my_daycare_id());
create policy "permitted staff manage center time off" on staff_time_off_requests for all
  using (has_permission('staff', 'approve') and daycare_id = get_my_daycare_id())
  with check (has_permission('staff', 'approve') and daycare_id = get_my_daycare_id());

create or replace function enforce_time_entry_review_permission()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_profile uuid;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  select profile_id into v_profile from staff_members where id = new.staff_member_id;
  if v_profile = auth.uid() and old.status in ('open', 'submitted', 'rejected')
     and new.status in ('open', 'submitted') then return new; end if;
  if new.status in ('approved', 'rejected') and new.status is distinct from old.status then
    if not has_permission('staff', 'approve') then raise exception 'Staff approval permission required'; end if;
  elsif not has_permission('staff', 'edit') then
    raise exception 'Staff edit permission required';
  end if;
  return new;
end;
$$;
create trigger enforce_time_entry_review before update on staff_time_entries
  for each row execute function enforce_time_entry_review_permission();

drop policy if exists "staff read roles" on center_roles;
drop policy if exists "admins manage roles" on center_roles;
create policy "permitted staff read roles" on center_roles for select
  using (has_permission('staff', 'view') and daycare_id = get_my_daycare_id());
create policy "permitted staff manage roles" on center_roles for all
  using (has_permission('staff', 'approve') and daycare_id = get_my_daycare_id() and not is_locked)
  with check (has_permission('staff', 'approve') and daycare_id = get_my_daycare_id() and not is_locked);

-- Invites are accepted by the invitee through a definer function. All other
-- staff mutations performed through definer RPCs must still carry permission.
create or replace function enforce_staff_admin_mutation()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'staff_invites' and tg_op = 'UPDATE'
     and old.accepted_at is null and new.accepted_by = auth.uid()
     and new.accepted_at is not null then return new; end if;
  if tg_table_name = 'staff_members' and new.profile_id = auth.uid()
     and (tg_op = 'INSERT' or old.profile_id = auth.uid()) then return new; end if;
  if tg_table_name = 'educator_classrooms' and new.educator_id = auth.uid() and tg_op = 'INSERT' then return new; end if;
  if not has_permission('staff', 'edit') then raise exception 'Staff edit permission required'; end if;
  return coalesce(new, old);
end;
$$;

create trigger enforce_staff_members_admin before insert or update or delete on staff_members
  for each row execute function enforce_staff_admin_mutation();
create trigger enforce_staff_invites_admin before insert or update or delete on staff_invites
  for each row execute function enforce_staff_admin_mutation();
create trigger enforce_educator_assignments_admin before insert or update or delete on educator_classrooms
  for each row execute function enforce_staff_admin_mutation();

create or replace function enforce_profile_role_assignment()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  if new.role is not distinct from old.role
     and new.daycare_id is not distinct from old.daycare_id
     and new.center_role_id is not distinct from old.center_role_id then return new; end if;

  -- First-time center owner setup.
  if new.id = auth.uid() and old.daycare_id is null and new.role = 'owner_admin'
     and exists (select 1 from daycares d where d.id = new.daycare_id and d.created_by = auth.uid()) then
    select id into new.center_role_id from center_roles
     where daycare_id = new.daycare_id and name = 'Owner admin' limit 1;
    return new;
  end if;
  -- Invite acceptance can attach the invitee to the invited center/role.
  if new.id = auth.uid() and old.daycare_id is null and exists (
    select 1 from staff_invites si
     where lower(si.email) = lower(new.email) and si.daycare_id = new.daycare_id
       and si.role = new.role and si.accepted_at is null
       and (si.expires_at is null or si.expires_at > now())
  ) then return new; end if;
  -- Legacy center join codes are still supported during the migration window.
  if new.id = auth.uid() and old.daycare_id is null and exists (
    select 1 from daycare_signup_codes dc
     where dc.daycare_id = new.daycare_id and dc.role = new.role
       and coalesce(dc.uses_remaining, 0) > 0
       and (dc.expires_at is null or dc.expires_at > now())
  ) then return new; end if;
  -- A parent adopts the linked child's center when redeeming an invite.
  if new.id = auth.uid() and new.role = 'parent' and old.daycare_id is null
     and new.daycare_id is not null and exists (
    select 1 from child_invite_codes ci
    join children c on c.id = ci.child_id
     where c.daycare_id = new.daycare_id and ci.used_at is null
       and (ci.email is null or lower(ci.email) = lower(new.email))
       and (ci.expires_at is null or ci.expires_at > now())
  ) then return new; end if;

  if not has_permission('staff', 'approve') then raise exception 'Staff approval permission required'; end if;
  if new.role is distinct from old.role
     and new.center_role_id is not distinct from old.center_role_id then
    select r.id into new.center_role_id
      from center_roles r
     where r.daycare_id = new.daycare_id
       and r.name = default_role_name(new.role, null, new.classroom_id)
     limit 1;
  end if;
  return new;
end;
$$;

create trigger enforce_profile_role_assignment before update of role, daycare_id, center_role_id on profiles
  for each row execute function enforce_profile_role_assignment();

-- ── Sensitive reads and notification enqueue ────────────────────────────────
drop policy if exists "admins read audit log" on audit_log;
create policy "permitted staff read audit log" on audit_log for select
  using (has_permission('reports', 'view') and daycare_id = get_my_daycare_id());
drop policy if exists "admins read center delivery history" on notification_outbox;
create policy "permitted staff read delivery history" on notification_outbox for select
  using (has_permission('reports', 'view') and daycare_id = get_my_daycare_id());

create or replace function enforce_notification_enqueue_permission()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_area text;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  v_area := case new.kind
    when 'announcement' then 'broadcasts'
    when 'incident' then 'incidents'
    when 'medication' then 'medications'
    when 'invoice' then 'billing'
    when 'payment' then 'billing'
    when 'staff_invite' then 'staff'
    when 'parent_invite' then 'children'
    else 'daily_logs'
  end;
  if not has_permission(v_area, 'edit') then
    raise exception '% edit permission required', v_area;
  end if;
  return new;
end;
$$;
create trigger enforce_notification_enqueue before insert on notification_outbox
  for each row execute function enforce_notification_enqueue_permission();

create or replace function get_billing_summary()
returns table (
  collected_month_cents bigint, expected_month_cents bigint,
  outstanding_cents bigint, overdue_count bigint, open_count bigint
)
language sql security definer stable
set search_path = public
as $$
  select
    (select coalesce(sum(p.amount_cents), 0) from payments p
      where p.daycare_id = get_my_daycare_id() and p.status = 'succeeded'
        and date_trunc('month', p.paid_at) = date_trunc('month', now())),
    (select coalesce(sum(i.total_cents), 0) from invoices i
      where i.daycare_id = get_my_daycare_id() and i.status <> 'void'
        and date_trunc('month', i.issued_on) = date_trunc('month', center_today()::timestamp)),
    (select coalesce(sum(i.total_cents - coalesce(paid.cents, 0)), 0)
       from invoices i left join lateral (
         select sum(amount_cents) cents from payments
          where invoice_id = i.id and status = 'succeeded'
       ) paid on true
      where i.daycare_id = get_my_daycare_id() and i.status = 'open'),
    (select count(*) from invoices i where i.daycare_id = get_my_daycare_id()
      and i.status = 'open' and i.due_on < center_today()),
    (select count(*) from invoices i where i.daycare_id = get_my_daycare_id() and i.status = 'open')
  where has_permission('billing', 'view')
$$;

create or replace function get_center_roles()
returns table (
  id uuid, name text, description text, base_role text,
  is_locked boolean, is_system boolean, sort int, permissions jsonb,
  member_count bigint
)
language sql security definer stable
set search_path = public
as $$
  select r.id, r.name, r.description, r.base_role, r.is_locked, r.is_system,
         r.sort, r.permissions,
         (select count(*) from profiles p where p.center_role_id = r.id)
    from center_roles r
   where r.daycare_id = get_my_daycare_id() and has_permission('staff', 'view')
   order by r.sort, r.name
$$;

create or replace function get_daycare_users()
returns table (
  id uuid, email text, full_name text, role text,
  classroom_id uuid, created_at timestamptz
)
language sql security definer stable
set search_path = public
as $$
  select p.id, p.email, p.full_name, p.role, p.classroom_id, p.created_at
    from profiles p
   where p.daycare_id = get_my_daycare_id() and has_permission('staff', 'view')
   order by p.role, p.full_name
$$;

grant execute on function has_permission(text, text) to authenticated;
grant execute on function can_access_child_area(uuid, text, text) to authenticated;
grant execute on function can_access_billing_family(uuid, text) to authenticated;
