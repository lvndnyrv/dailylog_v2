-- ============================================================================
-- DailyLog — Phase 1 Module C: children screens (20a/20b, 19a–19d)
-- ============================================================================

-- 19d edit form fields the baseline didn't carry
alter table children add column if not exists preferred_name text;
alter table children add column if not exists pronouns text;
alter table children add column if not exists home_address text;
alter table children add column if not exists dietary_needs text;

-- ─────────────────────────────────────────────────────────────────────────────
-- Authorized pickups (19a list + 19c modal). These are people, not app users:
-- grandparents, neighbours — verified at the door by a 4-digit PIN that also
-- backs the mobile family pass.
-- ─────────────────────────────────────────────────────────────────────────────

create table child_pickups (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  full_name text not null,
  relationship text,
  phone text,
  pin text not null,
  is_primary boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index child_pickups_child_idx on child_pickups (child_id) where archived_at is null;

create trigger child_pickups_updated_at
  before update on child_pickups
  for each row execute function update_updated_at();

alter table child_pickups enable row level security;

create policy "read pickups by child access" on child_pickups
  for select using (can_access_child(child_id));

create policy "staff manage pickups" on child_pickups
  for all using (can_write_child(child_id))
  with check (can_write_child(child_id) and daycare_id = get_my_daycare_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Guardian invites by email (19a "Invite or link a parent"). Rides
-- child_invite_codes; email/relationship let the accept flow verify identity
-- and label the link.
-- ─────────────────────────────────────────────────────────────────────────────

alter table child_invite_codes add column if not exists email text;
alter table child_invite_codes add column if not exists relationship text;

create or replace function create_parent_invite(
  p_child_id uuid,
  p_email text,
  p_relationship text default null
)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not can_write_child(p_child_id) then
    raise exception 'No access to this child';
  end if;

  v_code := generate_invite_code();

  insert into child_invite_codes (daycare_id, child_id, code, email, relationship,
                                  created_by, expires_at)
  select c.daycare_id, c.id, v_code, lower(p_email), p_relationship,
         auth.uid(), now() + interval '14 days'
  from children c
  where c.id = p_child_id;

  return v_code;
end;
$$;
