-- ============================================================================
-- DailyLog — seed (Phase 0)
-- ============================================================================
-- Fixture data matching the design prototypes (design/designs/*.dc.html):
-- Sunny Grove center, owner Amara Osei, rooms Infant/Toddler/Preschool/
-- Kindergarten, and child/parent names harvested from the admin design.
-- The design shows 4 rooms, so 4 are seeded (PHASE_0 said 3 — see DECISIONS.md).
--
-- Deterministic uuids (referenced by supabase/tests/rls_smoke_test.sql):
--   profiles  00000000-0000-4000-a000-0000000000NN  (01 owner, 02 admin,
--             03-08 educators, 11-34 parents)
--   daycare   10000000-0000-4000-a000-000000000001
--   rooms     20000000-0000-4000-a000-00000000000N  (1 Infant … 4 Kindergarten)
--   children  30000000-0000-4000-a000-0000000000NN  (01-24)
--
-- All seeded logins use password "password123" (local dev only).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Center
-- ─────────────────────────────────────────────────────────────────────────────

insert into daycares (id, name, address, phone, created_by) values
  ('10000000-0000-4000-a000-000000000001',
   'Sunny Grove Early Learning', '48 Main Street', '555-0148', null);

insert into classrooms (id, daycare_id, name, age_group,
                        min_age_months, max_age_months, capacity,
                        ratio_children_per_educator) values
  ('20000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001',
   'Infant', 'Infant', 3, 18, 8, 3),
  ('20000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001',
   'Toddler', 'Toddler', 18, 36, 10, 5),
  ('20000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000001',
   'Preschool', 'Preschool', 36, 60, 16, 8),
  ('20000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000001',
   'Kindergarten', 'Kindergarten', 60, 72, 18, 10);

-- ─────────────────────────────────────────────────────────────────────────────
-- Auth users + profiles
-- ─────────────────────────────────────────────────────────────────────────────
-- handle_new_user creates the profile row from raw_user_meta_data; we then
-- attach daycare/classroom. crypt/gen_salt live in the extensions schema.

create or replace function pg_temp.seed_user(
  p_id uuid, p_email text, p_full_name text, p_role text
)
returns void
language plpgsql
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    -- empty-string (not NULL) token fields — GoTrue scans these as strings
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, extensions.crypt('password123', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}',
    json_build_object('full_name', p_full_name, 'role', p_role)::jsonb,
    now(), now(),
    '', '', '', '', ''
  );

  -- GoTrue only honours password sign-in when a matching email identity exists
  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
    'email', p_id::text, now(), now(), now()
  );
end;
$$;

-- Staff (8): owner, admin, 6 educators
select pg_temp.seed_user('00000000-0000-4000-a000-000000000001', 'amara@sunnygrove.test',  'Amara Osei',     'owner_admin');
select pg_temp.seed_user('00000000-0000-4000-a000-000000000002', 'dana@sunnygrove.test',   'Dana Whitmore',  'admin');
select pg_temp.seed_user('00000000-0000-4000-a000-000000000003', 'maria@sunnygrove.test',  'Maria Kowalski', 'educator');
select pg_temp.seed_user('00000000-0000-4000-a000-000000000004', 'sam@sunnygrove.test',    'Sam Porter',     'educator');
select pg_temp.seed_user('00000000-0000-4000-a000-000000000005', 'pete@sunnygrove.test',   'Pete Salas',     'educator');
select pg_temp.seed_user('00000000-0000-4000-a000-000000000006', 'priya@sunnygrove.test',  'Priya Sharma',   'educator');
select pg_temp.seed_user('00000000-0000-4000-a000-000000000007', 'tara@sunnygrove.test',   'Tara Nguyen',    'educator');
select pg_temp.seed_user('00000000-0000-4000-a000-000000000008', 'grace@sunnygrove.test',  'Grace Chen',     'educator');

update profiles
   set daycare_id = '10000000-0000-4000-a000-000000000001'
 where id::text like '00000000-0000-4000-a000-0000000000%';

-- primary classroom per educator (03 Infant, 04 Toddler, 05 Preschool,
-- 06 Kindergarten, 07 Infant float, 08 Preschool float)
update profiles set classroom_id = '20000000-0000-4000-a000-000000000001' where id = '00000000-0000-4000-a000-000000000003';
update profiles set classroom_id = '20000000-0000-4000-a000-000000000002' where id = '00000000-0000-4000-a000-000000000004';
update profiles set classroom_id = '20000000-0000-4000-a000-000000000003' where id = '00000000-0000-4000-a000-000000000005';
update profiles set classroom_id = '20000000-0000-4000-a000-000000000004' where id = '00000000-0000-4000-a000-000000000006';
update profiles set classroom_id = '20000000-0000-4000-a000-000000000001' where id = '00000000-0000-4000-a000-000000000007';
update profiles set classroom_id = '20000000-0000-4000-a000-000000000003' where id = '00000000-0000-4000-a000-000000000008';

insert into educator_classrooms (educator_id, classroom_id)
select id, classroom_id from profiles
 where role = 'educator' and classroom_id is not null;

insert into staff_members (daycare_id, profile_id, job_title, employment_type, started_on, status)
select '10000000-0000-4000-a000-000000000001', id,
       case role when 'owner_admin' then 'Director'
                 when 'admin' then 'Assistant Director'
                 else 'Early Childhood Educator' end,
       'full_time',
       current_date - interval '2 years',
       'active'
  from profiles
 where role in ('owner_admin', 'admin', 'educator');

-- ─────────────────────────────────────────────────────────────────────────────
-- Children (24) + parents (24, surname-matched) + guardian links
-- ─────────────────────────────────────────────────────────────────────────────
-- Rooms: 01-06 Infant · 07-12 Toddler · 13-18 Preschool · 19-24 Kindergarten.
-- Child 01 (Ivy Tran) is a single-child family — the RLS smoke test depends on
-- parent 11 being linked to exactly one child. David & Sara Danyar (02, 03)
-- share parent Marc Danyar (12).

do $$
declare
  -- {first, last, parent_first} per child; parent NN = 10 + child index,
  -- except Sara Danyar (03) who shares parent 12
  kids text[][] := array[
    ['Ivy',     'Tran',      'Van'],      -- 01 Infant
    ['David',   'Danyar',    'Marc'],     -- 02 Infant
    ['Sara',    'Danyar',    ''],         -- 03 Infant (shares parent 12)
    ['Ada',     'Whitfield', 'Rui'],      -- 04 Infant
    ['Luca',    'Ferreira',  'Marta'],    -- 05 Infant
    ['Mila',    'Okafor',    'Chidi'],    -- 06 Infant
    ['Theo',    'Laurent',   'Camille'],  -- 07 Toddler
    ['Ana',     'Ferreira',  'Rui'],      -- 08 Toddler
    ['Ada',     'Okafor',    'Ngozi'],    -- 09 Toddler
    ['Sofia',   'Rendon',    'Carlos'],   -- 10 Toddler
    ['Kofi',    'Mensah',    'Abena'],    -- 11 Toddler
    ['Noah',    'Berg',      'Elsa'],     -- 12 Toddler
    ['Mateo',   'Castillo',  'Lucia'],    -- 13 Preschool
    ['Sofia',   'Reyes',     'Miguel'],   -- 14 Preschool
    ['Rosa',    'Torres',    'Elena'],    -- 15 Preschool
    ['Lena',    'Fischer',   'Jonas'],    -- 16 Preschool
    ['Ruth',    'Adeyemi',   'Femi'],     -- 17 Preschool
    ['Elvin',   'Diaz',      'Rosa'],     -- 18 Preschool
    ['Lily',    'Whitfield', 'Mae'],      -- 19 Kindergarten
    ['Omar',    'Haddad',    'Leila'],    -- 20 Kindergarten
    ['Nina',    'Petrov',    'Ivan'],     -- 21 Kindergarten
    ['Jonah',   'Clarke',    'Simone'],   -- 22 Kindergarten
    ['Maya',    'Singh',     'Arjun'],    -- 23 Kindergarten
    ['Sam',     'Reid',      'Alex']      -- 24 Kindergarten
  ];
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_child uuid;
  v_parent uuid;
  v_room uuid;
  v_dob date;
  i int;
begin
  for i in 1..24 loop
    v_child := ('30000000-0000-4000-a000-0000000000' || lpad(i::text, 2, '0'))::uuid;
    v_room  := ('20000000-0000-4000-a000-00000000000' || (((i - 1) / 6) + 1))::uuid;
    v_dob   := case ((i - 1) / 6)
                 when 0 then current_date - (300 + i * 10)        -- infants ~10-15 mo
                 when 1 then current_date - (600 + i * 10)        -- toddlers ~2y
                 when 2 then current_date - (1150 + i * 10)       -- preschool ~3.5y
                 else        current_date - (1850 + i * 10)       -- kindergarten ~5.5y
               end;

    insert into children (id, daycare_id, classroom_id, first_name, last_name,
                          date_of_birth, enrolled_on)
    values (v_child, v_daycare, v_room, kids[i][1], kids[i][2], v_dob,
            current_date - interval '10 months');

    if kids[i][3] <> '' then
      v_parent := ('00000000-0000-4000-a000-0000000000' || (10 + i))::uuid;
      perform pg_temp.seed_user(
        v_parent,
        lower(kids[i][3]) || '.' || lower(kids[i][2]) || '@parent.test',
        kids[i][3] || ' ' || kids[i][2],
        'parent'
      );
    else
      v_parent := '00000000-0000-4000-a000-000000000012';  -- Marc Danyar
    end if;

    insert into parent_children (parent_id, child_id, relationship,
                                 pickup_authorized, is_primary, consent_given_at)
    values (v_parent, v_child, 'parent', true, true, now());
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Two weeks of attendance + daily logs (weekdays only)
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  c record;
  v_day date;
  v_log uuid;
  v_educator uuid;
  v_in timestamptz;
  seed_moods text[] := array['happy', 'playful', 'calm', 'curious', 'sleepy'];
begin
  for c in select ch.id, ch.classroom_id,
                  ((select array_agg(p.id order by p.id)
                      from profiles p
                     where p.role = 'educator' and p.classroom_id = ch.classroom_id))
                    as educators
             from children ch
  loop
    for v_day in select d::date from generate_series(current_date - 13, current_date, '1 day') d
    loop
      continue when extract(isodow from v_day) > 5;  -- weekends off

      -- ~7% random absences
      if random() < 0.07 then
        insert into attendance_records (daycare_id, child_id, date, status, absence_reason, method)
        values (v_daycare, c.id, v_day, 'absent', 'sick', 'parent');
        continue;
      end if;

      v_educator := c.educators[1 + floor(random() * array_length(c.educators, 1))::int];
      -- anchor times in the center's timezone, not the server's (UTC)
      v_in := ((v_day + time '07:45')::timestamp at time zone 'America/Toronto')
              + (random() * interval '75 minutes');

      insert into attendance_records (daycare_id, child_id, date, checked_in_at,
                                      checked_in_by, checked_out_at, checked_out_by,
                                      method, status)
      values (v_daycare, c.id, v_day, v_in, v_educator,
              -- today's kids are still checked in
              case when v_day = current_date then null
                   else ((v_day + time '16:15')::timestamp at time zone 'America/Toronto')
                        + (random() * interval '75 minutes') end,
              case when v_day = current_date then null else v_educator end,
              'educator', 'present');

      insert into daily_logs (daycare_id, child_id, educator_id, log_date, moods,
                              notes, sent_to_parents, sent_at)
      values (v_daycare, c.id, v_educator, v_day,
              array[seed_moods[1 + floor(random() * 5)::int]],
              'Had a great day!',
              v_day < current_date,
              case when v_day < current_date
                   then (v_day + time '17:00')::timestamp at time zone 'America/Toronto' end)
      returning id into v_log;

      insert into meal_entries (daily_log_id, time, food_type, amount) values
        (v_log, '08:30', 'Breakfast', (array['all','some','none'])[1 + floor(random() * 3)::int]),
        (v_log, '11:45', 'Lunch',     (array['all','some','none'])[1 + floor(random() * 3)::int]),
        (v_log, '15:00', 'Snack',     (array['all','some'])[1 + floor(random() * 2)::int]);

      insert into sleep_entries (daily_log_id, start_time, end_time)
      values (v_log, '12:30', time '13:30' + (random() * interval '45 minutes'));

      -- diapers for infants/toddlers only
      if c.classroom_id in ('20000000-0000-4000-a000-000000000001',
                            '20000000-0000-4000-a000-000000000002') then
        insert into diaper_entries (daily_log_id, time, type, wet, bm) values
          (v_log, '09:15', 'diaper', true,  false),
          (v_log, '13:45', 'diaper', true,  random() < 0.5);
      end if;

      insert into activity_entries (daily_log_id, activity_name)
      values (v_log, (array['Outdoor play', 'Story time', 'Art & crafts',
                            'Music circle', 'Sensory bins'])[1 + floor(random() * 5)::int]);
    end loop;
  end loop;
end $$;

-- parents belong to their children's daycare (created after the staff-wide
-- daycare update above, so set here)
update profiles p
   set daycare_id = c.daycare_id
  from parent_children pc
  join children c on c.id = pc.child_id
 where p.id = pc.parent_id and p.daycare_id is null;

-- one child close to aging out of their room, so the transitions panel (7e)
-- has something to show
update children set date_of_birth = (current_date - interval '35 months')::date
 where first_name = 'Noah' and last_name = 'Berg';

-- allergies matching the design's roster examples (20a shows the flags)
update children set allergies = array['Peanuts'],
       medical_notes = 'Carries an EpiPen — kept in the classroom med box, not the cubby.'
 where first_name = 'David' and last_name = 'Danyar';
update children set allergies = array['Dairy']
 where first_name = 'Ada' and last_name = 'Whitfield';

-- two incidents awaiting admin sign-off (9b has a queue to verify against)
insert into incident_reports (daycare_id, child_id, educator_id, classroom_id,
  occurred_at, location, severity, injury_type, body_parts, description,
  first_aid_given, status)
select c.daycare_id, c.id, '00000000-0000-4000-a000-000000000003', c.classroom_id,
       now() - interval '2 hours', 'classroom', 'minor', 'bump', array['head'],
       'Pulled up on the soft shelf, lost balance and sat down hard — small bump on the back of the head. No fall from height.',
       'Comforted, cold pack for 5 minutes, checked per the bump protocol. Back to playing within 15 minutes.',
       'submitted'
from children c where c.first_name = 'Ivy' and c.last_name = 'Tran';

insert into incident_reports (daycare_id, child_id, educator_id, classroom_id,
  occurred_at, location, severity, injury_type, body_parts, description,
  first_aid_given, status)
select c.daycare_id, c.id, '00000000-0000-4000-a000-000000000004', c.classroom_id,
       now() - interval '45 minutes', 'playground', 'minor', 'scrape', array['knee'],
       'Tripped on the playground edge during outdoor play — small scrape on the left knee.',
       'Cleaned with water, bandage applied. No swelling; walking fine.',
       'submitted'
from children c where c.first_name = 'Kofi' and c.last_name = 'Mensah';

-- four message threads for the inbox (two left unread)
do $$
declare
  kid record;
  conv uuid;
  parent uuid;
  staff uuid := '00000000-0000-4000-a000-000000000003';
  i int := 0;
  bodies text[][] := array[
    ['Morning! Small rash on her left arm — the cream is in the cubby, could someone put it on after lunch?', null],
    ['Grandma Rosa will do Thursday pickups from now on — she has her PIN.', 'Noted — Rosa is on the approved list, all set for Thursdays!'],
    ['Running late this morning — we''ll be there by 10.', null],
    ['Thanks for the nap update yesterday!', 'Anytime! He settled quickly today too.']
  ];
begin
  for kid in
    select c.id, c.daycare_id from children c
    where c.archived_at is null order by c.first_name limit 4
  loop
    i := i + 1;
    select pc.parent_id into parent from parent_children pc where pc.child_id = kid.id limit 1;

    insert into conversations (daycare_id, child_id, kind, last_message_at)
    values (kid.daycare_id, kid.id, 'direct', now()) returning id into conv;

    insert into messages (daycare_id, conversation_id, child_id, sender_id, body, created_at)
    values (kid.daycare_id, conv, kid.id, parent, bodies[i][1], now() - (interval '1 hour') * i);

    if bodies[i][2] is not null then
      insert into messages (daycare_id, conversation_id, child_id, sender_id, body, created_at, read_at)
      values (kid.daycare_id, conv, kid.id, staff, bodies[i][2],
              now() - (interval '1 hour') * i + interval '10 minutes', now());
      update messages set read_at = now()
       where conversation_id = conv and sender_id = parent;
    end if;
  end loop;
end $$;

-- billing: two plans + three sample invoices (overdue / paid / open).
-- create_invoice checks is_admin(), so impersonate the owner for these.
insert into billing_plans (daycare_id, name, amount_cents, cadence) values
  ('10000000-0000-4000-a000-000000000001', 'Infant full-time', 128000, 'monthly'),
  ('10000000-0000-4000-a000-000000000001', 'Toddler & up full-time', 95000, 'monthly');

select set_config('role','authenticated',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}',false);

select create_invoice(
  (select id from children where first_name='Luca' and last_name='Ferreira'),
  (select pc.parent_id from parent_children pc join children c on c.id=pc.child_id where c.first_name='Luca' limit 1),
  current_date - 12,
  '[{"description":"July tuition — Infant full-time","quantity":1,"unit_amount_cents":78000}]'::jsonb);

select create_invoice(
  (select id from children where first_name='David' and last_name='Danyar'),
  (select pc.parent_id from parent_children pc join children c on c.id=pc.child_id where c.first_name='David' limit 1),
  current_date - 5,
  '[{"description":"July tuition — Infant full-time","quantity":1,"unit_amount_cents":128000}]'::jsonb);
select record_invoice_payment((select id from invoices where number like '%-002'), 128000, 'bank');

select create_invoice(
  (select id from children where first_name='Ivy' and last_name='Tran'),
  (select pc.parent_id from parent_children pc join children c on c.id=pc.child_id where c.first_name='Ivy' limit 1),
  current_date + 9,
  '[{"description":"July tuition — Infant full-time","quantity":1,"unit_amount_cents":128000},{"description":"Late pickup — Jul 2 (22 min)","quantity":1,"unit_amount_cents":2200}]'::jsonb);

select set_config('role','postgres',false);

-- certifications: one expiring soon (compliance register 12a shows the states)
update staff_members set certifications = jsonb_build_array(
  jsonb_build_object('item','First Aid','issuer','Red Cross','issued','2024-07-01',
                     'expires_on', to_char(current_date + 21, 'YYYY-MM-DD')),
  jsonb_build_object('item','CPR — infant & child','issuer','Red Cross','issued','2026-01-10',
                     'expires_on','2028-01-10'))
 where profile_id = '00000000-0000-4000-a000-000000000003';
update staff_members set certifications = jsonb_build_array(
  jsonb_build_object('item','Background check','issuer','Provincial registry',
                     'issued','2023-03-01','expires_on', null))
 where profile_id = '00000000-0000-4000-a000-000000000004';

-- enrollment pipeline samples across stages + closures
insert into enrollments (daycare_id, child_first_name, child_date_of_birth, guardian_name, guardian_email, guardian_phone, stage, desired_start_date, source, created_at) values
  ('10000000-0000-4000-a000-000000000001', 'Leo',    (current_date - interval '14 months')::date, 'Dana Alvarez',  'dana.alvarez@family.test',  '555-0101', 'inquiry',     (current_date + 45)::date, 'website',  now() - interval '3 days'),
  ('10000000-0000-4000-a000-000000000001', 'Kenji',  (current_date - interval '3 years')::date,   'Yuki Sato',     'yuki.sato@family.test',     '555-0102', 'inquiry',     (current_date + 45)::date, 'website',  now() - interval '1 day'),
  ('10000000-0000-4000-a000-000000000001', 'Chloé',  (current_date - interval '2 years')::date,   'Marc Laurent',  'marc.laurent@family.test',  '555-0103', 'tour',        (current_date + 20)::date, 'referral', now() - interval '6 days'),
  ('10000000-0000-4000-a000-000000000001', 'Élise',  (current_date - interval '18 months')::date, 'Anne Moreau',   'anne.moreau@family.test',   '555-0104', 'application', (current_date + 60)::date, 'referral', now() - interval '9 days'),
  ('10000000-0000-4000-a000-000000000001', 'Rory',   (current_date - interval '4 years')::date,   'Pat Brennan',   'pat.brennan@family.test',   '555-0105', 'offer',       (current_date + 10)::date, 'walk-in',  now() - interval '12 days');

insert into center_closures (daycare_id, starts_on, ends_on, reason) values
  ('10000000-0000-4000-a000-000000000001', date_trunc('month', now() + interval '1 month')::date + 2, date_trunc('month', now() + interval '1 month')::date + 2, 'Civic holiday'),
  ('10000000-0000-4000-a000-000000000001', date_trunc('year', now() + interval '1 year')::date - 7, date_trunc('year', now() + interval '1 year')::date + 1, 'Winter break');

-- a pinned welcome announcement so feeds aren't empty
insert into announcements (daycare_id, author_id, title, body, pinned)
values ('10000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000001',
        'Welcome to Sunny Grove!',
        'Our summer program starts next week — see the calendar for details.',
        true);
