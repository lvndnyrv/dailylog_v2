-- Verify the scheduler uses the same half-open ratio overlap as the preview.
begin;
do $$
declare
  v_center uuid;
  v_room uuid;
begin
  insert into public.daycares(name,timezone)
    values('Rollback-only ratio report center','UTC') returning id into v_center;
  insert into public.classrooms(daycare_id,name,capacity,ratio_children_per_educator)
    values(v_center,'Rollback ratio room',8,4) returning id into v_room;

  insert into public.room_ratio_history(
    daycare_id,classroom_id,starts_at,ends_at,present_count,staff_count,
    required_staff,max_children_per_staff,source
  ) values
    (v_center,v_room,'2019-12-31 23:00+00','2020-01-01 00:00+00',0,0,0,4,'scheduled_sweep'),
    (v_center,v_room,'2020-01-02 00:00+00','2020-01-02 01:00+00',0,0,0,4,'scheduled_sweep');
  if public._scheduled_report_row_count(v_center,'ratio','2020-01-01','2020-01-01')<>0 then
    raise exception 'FAIL: boundary-only intervals made an empty ratio report non-empty';
  end if;

  insert into public.room_ratio_history(
    daycare_id,classroom_id,starts_at,ends_at,present_count,staff_count,
    required_staff,max_children_per_staff,source
  ) values
    (v_center,v_room,'2020-01-01 01:00+00','2020-01-01 02:00+00',1,1,1,4,'scheduled_sweep'),
    (v_center,v_room,'2020-01-01 03:00+00','2020-01-01 04:00+00',1,1,1,4,'legacy_event');
  if public._scheduled_report_row_count(v_center,'ratio','2020-01-01','2020-01-01')<>1 then
    raise exception 'FAIL: in-period ratio interval was skipped or legacy row counted';
  end if;
end $$;
rollback;
select 'PASS: scheduled ratio skip-empty count follows preview interval boundaries' as result;
