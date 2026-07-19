-- Group 18 demo: three locations for the owner and light, realistic activity
-- at the two secondary sites. Safe to run repeatedly in local development.
update profile_daycare_memberships
set group_name = 'Sunny Grove Early Learning',
    location_label = 'Main Street',
    color = '#F0B441'
where profile_id = '00000000-0000-4000-a000-000000000001'
  and daycare_id = '10000000-0000-4000-a000-000000000001';

insert into daycares (id, name, address, created_by, active) values
  ('11800000-0000-4000-a000-000000000002', 'Sunny Grove Early Learning · Riverside', '88 Riverside Dr, Toronto, ON', '00000000-0000-4000-a000-000000000001', true),
  ('11800000-0000-4000-a000-000000000003', 'Sunny Grove Early Learning · Downtown', '214 King St W, Toronto, ON', '00000000-0000-4000-a000-000000000001', true)
on conflict (id) do update set name = excluded.name, address = excluded.address, active = true;

insert into profile_daycare_memberships (
  profile_id, daycare_id, group_name, location_label, color
) values
  ('00000000-0000-4000-a000-000000000001', '11800000-0000-4000-a000-000000000002', 'Sunny Grove Early Learning', 'Riverside', '#2F7CD8'),
  ('00000000-0000-4000-a000-000000000001', '11800000-0000-4000-a000-000000000003', 'Sunny Grove Early Learning', 'Downtown', '#7A5FD0')
on conflict (profile_id, daycare_id) do update set
  group_name = excluded.group_name,
  location_label = excluded.location_label,
  color = excluded.color;

insert into staff_members (
  id, daycare_id, profile_id, job_title, employment_type, started_on, status
) values
  ('41800000-0000-4000-a000-000000000002', '11800000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'Director', 'full_time', current_date - 500, 'active'),
  ('41800000-0000-4000-a000-000000000003', '11800000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', 'Director', 'full_time', current_date - 500, 'active')
on conflict (daycare_id, profile_id) do update set status = 'active', archived_at = null;

insert into classrooms (
  id, daycare_id, name, age_group, min_age_months, max_age_months,
  capacity, ratio_children_per_educator
) values
  ('21800000-0000-4000-a000-000000000021', '11800000-0000-4000-a000-000000000002', 'Toddler', 'Toddler', 18, 36, 10, 5),
  ('21800000-0000-4000-a000-000000000022', '11800000-0000-4000-a000-000000000002', 'Preschool', 'Preschool', 36, 60, 16, 8),
  ('21800000-0000-4000-a000-000000000031', '11800000-0000-4000-a000-000000000003', 'Toddler', 'Toddler', 18, 36, 10, 5),
  ('21800000-0000-4000-a000-000000000032', '11800000-0000-4000-a000-000000000003', 'Preschool', 'Preschool', 36, 60, 16, 8)
on conflict (id) do update set archived_at = null;

insert into children (
  id, daycare_id, classroom_id, first_name, last_name, date_of_birth,
  enrolled_on, setup_state
) values
  ('31800000-0000-4000-a000-000000000021', '11800000-0000-4000-a000-000000000002', '21800000-0000-4000-a000-000000000021', 'Mila', 'Novak', current_date - 900, current_date - 180, '{"basics":true,"photo":true,"medical":true,"emergency":true,"parents":true}'),
  ('31800000-0000-4000-a000-000000000022', '11800000-0000-4000-a000-000000000002', '21800000-0000-4000-a000-000000000022', 'Issa', 'Diallo', current_date - 1400, current_date - 120, '{"basics":true,"photo":true,"medical":true,"emergency":true,"parents":true}'),
  ('31800000-0000-4000-a000-000000000023', '11800000-0000-4000-a000-000000000002', '21800000-0000-4000-a000-000000000022', 'Sana', 'Haddad', current_date - 1600, current_date - 90, '{"basics":true,"photo":true,"medical":true,"emergency":true,"parents":true}'),
  ('31800000-0000-4000-a000-000000000031', '11800000-0000-4000-a000-000000000003', '21800000-0000-4000-a000-000000000031', 'Leo', 'Martin', current_date - 850, current_date - 150, '{"basics":true,"photo":true,"medical":true,"emergency":true,"parents":true}'),
  ('31800000-0000-4000-a000-000000000032', '11800000-0000-4000-a000-000000000003', '21800000-0000-4000-a000-000000000032', 'Ava', 'Wilson', current_date - 1500, current_date - 75, '{"basics":true,"photo":true,"medical":true,"emergency":true,"parents":true}')
on conflict (id) do update set classroom_id = excluded.classroom_id, archived_at = null;

insert into attendance_records (
  id, daycare_id, child_id, date, checked_in_at, method, status
) values
  ('81800000-0000-4000-a000-000000000021', '11800000-0000-4000-a000-000000000002', '31800000-0000-4000-a000-000000000021', current_date, date_trunc('day', now()) + interval '8 hours 5 minutes', 'educator', 'present'),
  ('81800000-0000-4000-a000-000000000022', '11800000-0000-4000-a000-000000000002', '31800000-0000-4000-a000-000000000022', current_date, date_trunc('day', now()) + interval '8 hours 20 minutes', 'educator', 'present'),
  ('81800000-0000-4000-a000-000000000023', '11800000-0000-4000-a000-000000000002', '31800000-0000-4000-a000-000000000023', current_date, date_trunc('day', now()) + interval '8 hours 42 minutes', 'kiosk', 'present'),
  ('81800000-0000-4000-a000-000000000031', '11800000-0000-4000-a000-000000000003', '31800000-0000-4000-a000-000000000031', current_date, date_trunc('day', now()) + interval '8 hours 10 minutes', 'educator', 'present'),
  ('81800000-0000-4000-a000-000000000032', '11800000-0000-4000-a000-000000000003', '31800000-0000-4000-a000-000000000032', current_date, date_trunc('day', now()) + interval '8 hours 34 minutes', 'kiosk', 'present')
on conflict (child_id, date) do update set
  checked_in_at = excluded.checked_in_at,
  checked_out_at = null,
  method = excluded.method,
  status = excluded.status;
