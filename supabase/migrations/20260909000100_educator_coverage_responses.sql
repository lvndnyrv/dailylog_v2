create or replace function public.save_room_coverage_plan(p_id uuid,p_room uuid,p_date date,p_segments jsonb,p_notify_lead boolean default true)
returns uuid[] language plpgsql security definer set search_path=public set jit=off as $$
declare c public.daycares; old_plan public.room_coverage_plans; item jsonb; assignment uuid; ids uuid[]:=array[]::uuid[];
  request_value jsonb; lead_id uuid; payload_value jsonb;
begin
  if not public.is_admin() or not public.has_permission('rooms','edit') then raise exception 'Room editing permission required'; end if;
  select * into c from public.daycares where id=public.get_my_daycare_id();
  if p_id is null or p_date is null or p_date<(now() at time zone c.timezone)::date or p_date>(now() at time zone c.timezone)::date+90 then raise exception 'Choose a planning date in the next 90 days'; end if;
  if jsonb_typeof(p_segments) is distinct from 'array' or jsonb_array_length(p_segments) not between 1 and 12 then raise exception 'Add between 1 and 12 coverage segments'; end if;
  perform pg_advisory_xact_lock(hashtextextended('coverage-plan:'||c.id::text,0));
  request_value:=jsonb_build_object('segments',p_segments,'notify_lead',coalesce(p_notify_lead,false));
  select * into old_plan from public.room_coverage_plans where id=p_id;
  if found then
    if old_plan.daycare_id<>c.id or old_plan.created_by<>auth.uid() or old_plan.classroom_id<>p_room or old_plan.planned_on<>p_date or old_plan.request<>request_value then
      raise exception 'This save request was already used. Refresh before creating a different plan';
    end if;
    return array(select id from public.room_coverage_assignments where plan_id=p_id order by starts_at,id);
  end if;
  if not exists(select 1 from public.classrooms where id=p_room and daycare_id=c.id and archived_at is null) then raise exception 'Room unavailable'; end if;
  insert into public.room_coverage_plans(id,daycare_id,classroom_id,planned_on,request,created_by) values(p_id,c.id,p_room,p_date,request_value,auth.uid());
  -- Stable staff order, plus the center lock, prevents competing batch loans racing.
  for item in select value from jsonb_array_elements(p_segments) order by value->>'profile_id',value->>'start' loop
    assignment:=public.assign_planned_room_coverage((item->>'profile_id')::uuid,p_room,p_date,(item->>'start')::time,(item->>'end')::time,
      coalesce((item->>'confirm')::boolean,false),item->>'notes');
    update public.room_coverage_assignments set plan_id=p_id where id=assignment;
    ids:=array_append(ids,assignment);
  end loop;
  if coalesce(p_notify_lead,false) then
    select p.id into lead_id from public.classrooms r join public.profiles p on p.id=r.lead_educator_id
      where r.id=p_room and p.daycare_id=c.id and p.archived_at is null;
    if lead_id is not null then
      payload_value:=jsonb_build_object('screen','RoomRatios','roomId',p_room,'planId',p_id,'date',p_date);
      insert into public.notifications(daycare_id,profile_id,kind,title,body,payload)
        values(c.id,lead_id,'coverage_plan','Room coverage planned',jsonb_array_length(p_segments)||' coverage segments planned for '||p_date||'. Invitations are awaiting acceptance.',payload_value);
      insert into public.notification_outbox(daycare_id,recipient_id,channel,kind,title,body,payload,dedupe_key)
        values(c.id,lead_id,'push','coverage_plan','Room coverage planned','Review the planned coverage and invitation responses.',payload_value,'coverage-plan:'||p_id::text) on conflict do nothing;
    end if;
  end if;
  return ids;
end $$;

create function public.get_my_room_coverage()
returns table(id uuid,room_id uuid,room_name text,starts_at timestamptz,ends_at timestamptz,status text,notes text,timezone text)
language sql stable security definer set search_path=public as $$
  select a.id,a.classroom_id,r.name,a.starts_at,a.ends_at,a.status,a.notes,d.timezone
  from public.room_coverage_assignments a join public.staff_members m on m.id=a.staff_member_id
  join public.profiles p on p.id=m.profile_id join public.classrooms r on r.id=a.classroom_id
  join public.daycares d on d.id=a.daycare_id
  where p.id=auth.uid() and p.role='educator' and p.archived_at is null and m.archived_at is null and m.status='active'
    and a.daycare_id=p.daycare_id and m.daycare_id=p.daycare_id
    and a.ends_at>now() and a.starts_at<now()+interval '91 days'
    and a.status in('assigned','accepted','declined','cancelled') order by a.starts_at,a.id;
$$;
revoke all on function public.get_my_room_coverage() from public,anon;
grant execute on function public.get_my_room_coverage() to authenticated;

create function public.respond_to_room_coverage(p_assignment uuid,p_response text)
returns void language plpgsql security definer set search_path=public set jit=off as $$
declare a public.room_coverage_assignments; m public.staff_members; c public.daycares; day date; conflict text; committed boolean; recipient uuid; payload_value jsonb;
begin
  if p_response is null or p_response not in('accepted','declined') then raise exception 'Choose accept or decline'; end if;
  select * into m from public.staff_members where profile_id=auth.uid() and daycare_id=public.get_my_daycare_id() and status='active' and archived_at is null;
  if m.id is null or not exists(select 1 from public.profiles where id=auth.uid() and role='educator' and archived_at is null) then raise exception 'Active educator account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('coverage-plan:'||m.daycare_id::text,0));
  select * into a from public.room_coverage_assignments where id=p_assignment and staff_member_id=m.id and daycare_id=m.daycare_id for update;
  if not found then raise exception 'Coverage invitation unavailable'; end if;
  if a.status=p_response then return; end if;
  if a.status<>'assigned' or a.ends_at<=now() then raise exception 'This invitation is no longer awaiting a response. Refresh your coverage list'; end if;
  select * into c from public.daycares where id=m.daycare_id;
  day:=(a.starts_at at time zone c.timezone)::date;
  if p_response='accepted' then
    if not public._forecast_staff_eligible(m.id,day) then raise exception 'Eligibility or approved leave changed. Ask your administrator to review this coverage'; end if;
    if exists(select 1 from public.center_closures where daycare_id=c.id and day between starts_on and ends_on)
      or (a.starts_at at time zone c.timezone)::time<c.opens_at or (a.ends_at at time zone c.timezone)::time>c.closes_at then raise exception 'Center hours or closure changed. Ask your administrator to review this coverage'; end if;
    conflict:=public._coverage_conflict_without_forecast(m.id,a.classroom_id,a.starts_at,a.ends_at,a.id);
    committed:=exists(select 1 from public.profiles where id=auth.uid() and classroom_id<>a.classroom_id)
      or exists(select 1 from public.educator_classrooms where educator_id=auth.uid() and classroom_id<>a.classroom_id)
      or exists(select 1 from public.staff_shifts where staff_member_id=m.id and status='published' and classroom_id<>a.classroom_id and starts_at<a.ends_at and ends_at>a.starts_at);
    if conflict is not null and conflict not like 'Published shift in another room%' then raise exception '%',conflict; end if;
    if committed and not public._can_lend_existing_coverage(m.id,a.classroom_id,a.starts_at,a.ends_at,a.id) then raise exception 'Source-room coverage changed. Ask your administrator to review this plan'; end if;
  end if;
  update public.room_coverage_assignments set status=p_response where id=a.id;
  payload_value:=jsonb_build_object('screen','RoomRatios','roomId',a.classroom_id,'assignmentId',a.id,'href','/rooms','response',p_response);
  for recipient in select id from public.profiles where daycare_id=c.id and role in('owner_admin','admin') and archived_at is null loop
    insert into public.notifications(daycare_id,profile_id,kind,title,body,payload)
      values(c.id,recipient,'coverage_response','Coverage invitation '||p_response,'An educator '||p_response||' coverage. Review the room plan for remaining gaps.',payload_value);
  end loop;
end $$;
revoke all on function public.respond_to_room_coverage(uuid,text) from public,anon;
grant execute on function public.respond_to_room_coverage(uuid,text) to authenticated;
