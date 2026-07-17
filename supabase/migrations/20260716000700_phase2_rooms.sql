-- ============================================================================
-- DailyLog — Phase 2 Module 1: rooms & ratios (7a–7e)
-- ============================================================================
-- Live ratio = children checked in today vs educators ASSIGNED to the room.
-- Staff clock-ins (the design's other input) arrive with timesheets, Phase 5 —
-- until then assignment is the best truth we have (DECISIONS.md).

create or replace function get_rooms_live_status()
returns table (
  id uuid,
  name text,
  age_group text,
  min_age_months int,
  max_age_months int,
  capacity int,
  ratio_children_per_educator int,
  enrolled_count bigint,
  present_count bigint,
  last_log_at timestamptz,
  educators jsonb
)
language sql security definer stable
set search_path = public
as $$
  select cl.id, cl.name, cl.age_group, cl.min_age_months, cl.max_age_months,
         cl.capacity, cl.ratio_children_per_educator,
         (select count(*) from children c
           where c.classroom_id = cl.id and c.archived_at is null),
         (select count(*) from attendance_records ar
           join children c on c.id = ar.child_id
          where c.classroom_id = cl.id
            and ar.date = current_date
            and ar.checked_in_at is not null
            and ar.checked_out_at is null),
         (select max(coalesce(dl.updated_at, dl.created_at))
            from daily_logs dl
            join children c on c.id = dl.child_id
           where c.classroom_id = cl.id and dl.log_date = current_date),
         coalesce(
           (select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name)
                             order by p.full_name)
              from profiles p
             where p.role = 'educator'
               and p.archived_at is null
               and (p.classroom_id = cl.id
                    or exists (select 1 from educator_classrooms ec
                                where ec.classroom_id = cl.id and ec.educator_id = p.id))),
           '[]'::jsonb)
  from classrooms cl
  where cl.daycare_id = get_my_daycare_id()
    and cl.archived_at is null
    and is_staff()
  order by cl.min_age_months nulls last, cl.name
$$;

-- Children close to (or past) their room's age band, with the suggested next
-- room (7e "Upcoming transitions"). p_horizon_months: how far ahead to look.
create or replace function get_room_transitions(p_horizon_months int default 2)
returns table (
  child_id uuid,
  first_name text,
  last_name text,
  date_of_birth date,
  age_months int,
  room_id uuid,
  room_name text,
  max_age_months int,
  next_room_id uuid,
  next_room_name text
)
language sql security definer stable
set search_path = public
as $$
  select c.id, c.first_name, c.last_name, c.date_of_birth,
         (extract(year from age(current_date, c.date_of_birth)) * 12
          + extract(month from age(current_date, c.date_of_birth)))::int,
         cl.id, cl.name, cl.max_age_months,
         nxt.id, nxt.name
  from children c
  join classrooms cl on cl.id = c.classroom_id
  left join lateral (
    select n.id, n.name
    from classrooms n
    where n.daycare_id = cl.daycare_id
      and n.archived_at is null
      and n.id <> cl.id
      and n.min_age_months >= cl.max_age_months
    order by n.min_age_months
    limit 1
  ) nxt on true
  where c.daycare_id = get_my_daycare_id()
    and is_staff()
    and c.archived_at is null
    and cl.max_age_months is not null
    and c.date_of_birth is not null
    -- within the horizon of aging out, or already past the band
    and (extract(year from age(current_date + (p_horizon_months || ' months')::interval,
                               c.date_of_birth)) * 12
         + extract(month from age(current_date + (p_horizon_months || ' months')::interval,
                                  c.date_of_birth))) >= cl.max_age_months
  order by c.date_of_birth
$$;
