-- ============================================
-- DailyLog — Week 3 SQL additions
-- Run this in Supabase SQL Editor AFTER the main schema
-- ============================================

-- Push notification tokens (one per user device)
create table if not exists push_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id) on delete cascade not null,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz default now(),
  unique(user_id, token)
);

alter table push_tokens enable row level security;

-- Users can only manage their own tokens
create policy "Users manage own push tokens"
  on push_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================
-- RPC: get parent push tokens for a child
-- Called by the educator app when sending a log
-- ============================================
create or replace function get_parent_push_tokens(p_child_id uuid)
returns table(token text, platform text) as $$
  select pt.token, pt.platform
  from push_tokens pt
  join parent_children pc on pc.parent_id = pt.user_id
  where pc.child_id = p_child_id
$$ language sql security definer stable;

-- ============================================
-- Seed data for Smart Kid South Newmarket pilot
-- Uncomment and fill in your real values, then run
-- ============================================

/*
-- 1. Insert the daycare
insert into daycares (id, name, address, phone) values
  ('11111111-1111-1111-1111-111111111111',
   'Smart Kid South Newmarket',
   'South Newmarket, ON',
   '905-555-0100')
on conflict do nothing;

-- 2. Insert the classroom
insert into classrooms (id, daycare_id, name, age_group) values
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   'Room 1',
   'Toddler')
on conflict do nothing;

-- 3. Insert the children
-- (Run AFTER creating educator account so you can copy their user ID)
insert into children (id, classroom_id, first_name, last_name, date_of_birth) values
  ('33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222',
   'David', 'YourLastName', '2023-03-15'),
  ('44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222',
   'Diana', 'YourLastName', '2024-01-10')
on conflict do nothing;

-- 4. After educator signs up in the app, update their profile with the classroom:
-- update profiles set classroom_id = '22222222-2222-2222-2222-222222222222',
--   daycare_id = '11111111-1111-1111-1111-111111111111'
-- where email = 'educator@smartkid.ca';

-- 5. After parent signs up, link them to the children:
-- insert into parent_children (parent_id, child_id) values
--   ((select id from profiles where email = 'parent@email.com'), '33333333-3333-3333-3333-333333333333'),
--   ((select id from profiles where email = 'parent@email.com'), '44444444-4444-4444-4444-444444444444');
*/
