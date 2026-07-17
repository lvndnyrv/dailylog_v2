-- ============================================================================
-- DailyLog — role library + permissions matrix (design 4o)
-- ============================================================================
-- A center-level role library. Each role carries a default permissions matrix
-- (area × view/edit/approve). This migration introduces and renders the matrix;
-- 20260717000500_p0_rbac_enforcement.sql applies it to RLS and definer paths.

create table center_roles (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  name text not null,
  description text,
  base_role text not null check (base_role in ('owner_admin', 'admin', 'educator')),
  is_locked boolean not null default false,   -- Owner admin can't be edited/deleted
  is_system boolean not null default false,   -- one of the 5 defaults
  sort int not null default 100,
  permissions jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (daycare_id, name)
);

create index center_roles_daycare_idx on center_roles (daycare_id, sort);

create trigger center_roles_updated_at
  before update on center_roles
  for each row execute function update_updated_at();

alter table center_roles enable row level security;

create policy "staff read roles" on center_roles
  for select using (is_staff() and daycare_id = get_my_daycare_id());

create policy "admins manage roles" on center_roles
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

-- Which role each staff profile holds (for counts + future assignment).
alter table profiles add column if not exists center_role_id uuid references center_roles(id) on delete set null;
create index if not exists profiles_center_role_idx on profiles (center_role_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Default role library
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function _perm(v boolean, e boolean, a boolean)
returns jsonb language sql immutable
as $$ select jsonb_build_object('view', v, 'edit', e, 'approve', a) $$;

-- Build a full 10-area permission object from per-area (view,edit,approve).
create or replace function _perms(
  daily_logs jsonb, attendance jsonb, medications jsonb, incidents jsonb,
  children jsonb, enrollment jsonb, broadcasts jsonb,
  billing jsonb, reports jsonb, staff jsonb
) returns jsonb language sql immutable
as $$
  select jsonb_build_object(
    'daily_logs', daily_logs, 'attendance', attendance, 'medications', medications,
    'incidents', incidents, 'children', children, 'enrollment', enrollment,
    'broadcasts', broadcasts, 'billing', billing, 'reports', reports, 'staff', staff)
$$;

-- Idempotent per-center seed of the 5 default roles (design 4o).
create or replace function seed_default_roles(p_daycare uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  all_yes jsonb := _perms(_perm(true,true,true), _perm(true,true,true), _perm(true,true,true),
    _perm(true,true,true), _perm(true,true,true), _perm(true,true,true), _perm(true,true,true),
    _perm(true,true,true), _perm(true,true,true), _perm(true,true,true));
begin
  insert into center_roles (daycare_id, name, description, base_role, is_locked, is_system, sort, permissions)
  values
    (p_daycare, 'Owner admin', 'Everything, every room — the center owner',
     'owner_admin', true, true, 0, all_yes),
    (p_daycare, 'Delegated admin', 'A trusted lead with full console access in the center',
     'admin', false, true, 1, all_yes),
    (p_daycare, 'Lead educator', 'Runs a room — logs, attendance, incidents, family broadcasts',
     'educator', false, true, 2, _perms(
       _perm(true,true,true), _perm(true,true,true), _perm(true,true,false), _perm(true,true,false),
       _perm(true,true,false), _perm(true,false,false), _perm(true,true,false),
       _perm(false,false,false), _perm(false,false,false), _perm(false,false,false))),
    (p_daycare, 'Educator', 'Room staff — logs, attendance and incidents for assigned rooms',
     'educator', false, true, 3, _perms(
       _perm(true,true,false), _perm(true,true,false), _perm(true,true,false), _perm(true,true,false),
       _perm(true,false,false), _perm(false,false,false), _perm(true,false,false),
       _perm(false,false,false), _perm(false,false,false), _perm(false,false,false))),
    (p_daycare, 'Floater', 'Covers rooms as needed — no fixed room assignment',
     'educator', false, true, 4, _perms(
       _perm(true,true,false), _perm(true,true,false), _perm(true,false,false), _perm(true,true,false),
       _perm(true,false,false), _perm(false,false,false), _perm(false,false,false),
       _perm(false,false,false), _perm(false,false,false), _perm(false,false,false)))
  on conflict (daycare_id, name) do nothing;
end;
$$;

-- Map a staff profile to its default role (name) by base role + lead/floater cues.
create or replace function default_role_name(
  p_role text, p_job_title text, p_classroom uuid
) returns text language sql immutable
as $$
  select case
    when p_role = 'owner_admin' then 'Owner admin'
    when p_role = 'admin' then 'Delegated admin'
    when p_role = 'educator' and coalesce(p_job_title,'') ilike '%lead%' then 'Lead educator'
    when p_role = 'educator' and p_classroom is null then 'Floater'
    when p_role = 'educator' then 'Educator'
    else null
  end
$$;

-- Seed roles for every existing center, then backfill each staff profile's role.
do $$
declare d uuid;
begin
  for d in select id from daycares loop
    perform seed_default_roles(d);
  end loop;
end $$;

update profiles p
   set center_role_id = r.id
  from center_roles r, staff_members sm
 where sm.profile_id = p.id
   and sm.daycare_id = r.daycare_id
   and r.daycare_id = p.daycare_id
   and p.center_role_id is null
   and r.name = default_role_name(p.role, sm.job_title, p.classroom_id);
-- admins/owners have no staff_members row guarantee — cover them directly
update profiles p
   set center_role_id = r.id
  from center_roles r
 where r.daycare_id = p.daycare_id
   and p.center_role_id is null
   and r.name = default_role_name(p.role, null, p.classroom_id)
   and p.role in ('owner_admin', 'admin', 'educator');

-- New hires: assign the default role on invite acceptance.
create or replace function accept_staff_invite(p_code text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_invite staff_invites%rowtype;
  v_my_email text;
  v_role_id uuid;
begin
  select * into v_invite
  from staff_invites
  where upper(code) = upper(p_code)
    and accepted_at is null
    and (expires_at is null or expires_at > now());

  if v_invite.id is null then
    raise exception 'Invalid or expired invite';
  end if;

  select email into v_my_email from profiles where id = auth.uid();
  if lower(v_my_email) <> lower(v_invite.email) then
    raise exception 'This invite was sent to a different email address';
  end if;

  update profiles
     set role = v_invite.role,
         daycare_id = v_invite.daycare_id,
         classroom_id = coalesce(v_invite.classroom_id, classroom_id)
   where id = auth.uid();

  if v_invite.role = 'educator' and v_invite.classroom_id is not null then
    insert into educator_classrooms (educator_id, classroom_id)
    values (auth.uid(), v_invite.classroom_id)
    on conflict do nothing;
  end if;

  insert into staff_members (daycare_id, profile_id, job_title, status)
  values (v_invite.daycare_id, auth.uid(), v_invite.job_title, 'active')
  on conflict (daycare_id, profile_id)
    do update set status = 'active',
                  job_title = coalesce(excluded.job_title, staff_members.job_title);

  select id into v_role_id from center_roles
   where daycare_id = v_invite.daycare_id
     and name = default_role_name(v_invite.role, v_invite.job_title, v_invite.classroom_id);
  update profiles set center_role_id = v_role_id where id = auth.uid();

  update staff_invites
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_invite.id;
end;
$$;

-- Roles with the live member count, for the library (design 4o left panel).
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
  where r.daycare_id = get_my_daycare_id()
    and is_staff()
  order by r.sort, r.name
$$;
