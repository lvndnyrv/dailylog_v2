-- Rollback-only check that empty-room intervals cannot inflate the inspection
-- pack's occupied-room ratio metric.
begin;
do $$
declare
  v_daycare uuid;
  v_room uuid;
  v_before jsonb;
  v_after jsonb;
begin
  select daycare_id into v_daycare from public.profiles
    where id='00000000-0000-4000-a000-000000000001';
  select id into v_room from public.classrooms where daycare_id=v_daycare limit 1;
  if v_daycare is null or v_room is null then
    raise exception 'Missing development center fixture';
  end if;
  v_before := public._compliance_ratio_ledger(v_daycare);
  if not v_before ? 'occupied_minutes' then
    raise exception 'Occupied-minute metric is missing';
  end if;

  insert into public.room_ratio_history
    (daycare_id,classroom_id,starts_at,ends_at,present_count,staff_count,required_staff,max_children_per_staff,source)
  values
    (v_daycare,v_room,now()-interval '40 minutes',now()-interval '35 minutes',0,0,0,5,'coverage'),
    (v_daycare,v_room,now()-interval '30 minutes',now()-interval '25 minutes',1,1,1,5,'coverage'),
    (v_daycare,v_room,now()-interval '20 minutes',now()-interval '15 minutes',1,0,1,5,'coverage');
  v_after := public._compliance_ratio_ledger(v_daycare);
  if (v_after->>'observed_minutes')::int - (v_before->>'observed_minutes')::int < 14 then
    raise exception 'Observed minutes did not include all synthetic intervals';
  end if;
  if (v_after->>'occupied_minutes')::int - (v_before->>'occupied_minutes')::int < 9 then
    raise exception 'Occupied minutes did not include both occupied intervals';
  end if;
  if (v_after->>'occupied_minutes')::int - (v_before->>'occupied_minutes')::int >= 14 then
    raise exception 'Empty-room time inflated occupied minutes';
  end if;
  if (v_after->>'occupied_over_minutes')::int - (v_before->>'occupied_over_minutes')::int < 4 then
    raise exception 'Occupied over-ratio time was not counted';
  end if;
end $$;
rollback;
select 'PASS: occupied ratio metrics exclude empty-room time' as result;
