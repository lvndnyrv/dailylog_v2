-- ============================================================================
-- DailyLog — Phase 2 Module 2: attendance (8a–8f)
-- ============================================================================

-- 8a's check-in log shows who dropped off / picked up and a day note
alter table attendance_records add column if not exists dropped_off_by text;
alter table attendance_records add column if not exists picked_up_by text;
alter table attendance_records add column if not exists notes text;

-- Last-7-days present counts for the "This week" rail card
create or replace function get_attendance_week()
returns table (day date, present_count bigint, absent_count bigint)
language sql security definer stable
set search_path = public
as $$
  select d::date,
         (select count(*) from attendance_records ar
           where ar.daycare_id = get_my_daycare_id()
             and ar.date = d::date and ar.checked_in_at is not null),
         (select count(*) from attendance_records ar
           where ar.daycare_id = get_my_daycare_id()
             and ar.date = d::date and ar.status in ('absent', 'excused'))
  from generate_series(current_date - 6, current_date, '1 day') d
  where is_staff()
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Kiosk (8b): the door tablet stays signed in as a staff account; the pickup
-- PIN (19c / the family pass backup code) authorizes the specific family.
-- Definer function so the tablet's educator login can check any room's child
-- in/out — PIN possession is the per-family authorization.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function kiosk_lookup_pin(p_pin text)
returns table (
  pickup_name text,
  child_id uuid,
  first_name text,
  last_name text,
  room_name text,
  checked_in_at timestamptz,
  checked_out_at timestamptz
)
language sql security definer stable
set search_path = public
as $$
  select cp.full_name, c.id, c.first_name, c.last_name, cl.name,
         ar.checked_in_at, ar.checked_out_at
  from child_pickups cp
  join children c on c.id = cp.child_id and c.archived_at is null
  left join classrooms cl on cl.id = c.classroom_id
  left join attendance_records ar on ar.child_id = c.id and ar.date = current_date
  where cp.pin = p_pin
    and cp.archived_at is null
    and cp.daycare_id = get_my_daycare_id()
    and is_staff()
$$;

create or replace function kiosk_check(p_child_id uuid, p_pin text)
returns text  -- 'checked_in' | 'checked_out'
language plpgsql security definer
set search_path = public
as $$
declare
  v_pickup child_pickups%rowtype;
  v_record attendance_records%rowtype;
begin
  if not is_staff() then
    raise exception 'Kiosk must be signed in as staff';
  end if;

  select * into v_pickup
  from child_pickups
  where pin = p_pin and child_id = p_child_id and archived_at is null
    and daycare_id = get_my_daycare_id();
  if v_pickup.id is null then
    raise exception 'PIN does not match this child';
  end if;

  select * into v_record
  from attendance_records
  where child_id = p_child_id and date = current_date;

  if v_record.id is null or v_record.checked_in_at is null then
    insert into attendance_records (daycare_id, child_id, date, checked_in_at,
                                    method, status, dropped_off_by)
    values (v_pickup.daycare_id, p_child_id, current_date, now(),
            'kiosk', 'present', v_pickup.full_name)
    on conflict (child_id, date) do update
      set checked_in_at = now(), method = 'kiosk', status = 'present',
          dropped_off_by = v_pickup.full_name,
          checked_out_at = null, checked_out_by = null;
    return 'checked_in';
  end if;

  if v_record.checked_out_at is null then
    update attendance_records
       set checked_out_at = now(), picked_up_by = v_pickup.full_name,
           method = 'kiosk'
     where id = v_record.id;
    return 'checked_out';
  end if;

  -- already out — treat as a re-check-in (e.g. appointment return)
  update attendance_records
     set checked_in_at = now(), checked_out_at = null,
         dropped_off_by = v_pickup.full_name, method = 'kiosk'
   where id = v_record.id;
  return 'checked_in';
end;
$$;
