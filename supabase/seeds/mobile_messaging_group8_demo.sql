-- Realistic data for mobile design groups 7 and 8.
-- Safe to rerun against the Sunny Grove development center.

update announcements
set
  title = 'Summer picnic — Friday, July 31',
  body = 'Join us at Fairy Lake Park from 11 AM. Pack a hat and sunscreen — we will provide lunch and snacks for everyone.',
  pinned = true,
  rsvp_enabled = true,
  event_at = date_trunc('day', now()) + interval '9 days 11 hours',
  updated_at = now()
where daycare_id = '10000000-0000-4000-a000-000000000001'
  and pinned = true;

insert into announcements (
  daycare_id,
  classroom_id,
  author_id,
  title,
  body,
  pinned,
  rsvp_enabled,
  created_at
)
select
  '10000000-0000-4000-a000-000000000001',
  '20000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000001',
  'Water play week',
  'Please bring a swimsuit, towel and a change of clothes every day this week.',
  false,
  false,
  now() - interval '1 day'
where not exists (
  select 1
  from announcements
  where daycare_id = '10000000-0000-4000-a000-000000000001'
    and title = 'Water play week'
);
