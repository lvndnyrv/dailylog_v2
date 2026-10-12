-- Atomic, retry-safe coverage plans. Individual invitations keep their existing handoff.
create table public.room_coverage_plans (
  id uuid primary key,
  daycare_id uuid not null references public.daycares(id),
  classroom_id uuid not null references public.classrooms(id),
  planned_on date not null,
  request jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.room_coverage_plans enable row level security;
create policy "admins read coverage plans" on public.room_coverage_plans for select to authenticated
  using(daycare_id=public.get_my_daycare_id() and public.is_admin() and public.has_permission('rooms','view'));
alter table public.room_coverage_assignments add column plan_id uuid references public.room_coverage_plans(id);
create index room_coverage_assignments_plan_idx on public.room_coverage_assignments(plan_id) where plan_id is not null;

create function public.save_room_coverage_plan(p_id uuid,p_room uuid,p_date date,p_segments jsonb,p_notify_lead boolean default true)
returns uuid[] language plpgsql security definer set search_path=public set jit=off as $$
declare c public.daycares; old_plan public.room_coverage_plans; item jsonb; assignment uuid; ids uuid[]:='{}';
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
revoke all on function public.save_room_coverage_plan(uuid,uuid,date,jsonb,boolean) from public,anon;
grant execute on function public.save_room_coverage_plan(uuid,uuid,date,jsonb,boolean) to authenticated;

create function public.cancel_planned_room_coverage(p_assignment uuid)
returns void language plpgsql security definer set search_path=public as $$
declare a public.room_coverage_assignments; recipient uuid; payload_value jsonb;
begin
  if not public.is_admin() or not public.has_permission('rooms','edit') then raise exception 'Room editing permission required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('coverage-plan:'||public.get_my_daycare_id()::text,0));
  select * into a from public.room_coverage_assignments where id=p_assignment and daycare_id=public.get_my_daycare_id() for update;
  if not found then raise exception 'Coverage unavailable'; end if;
  if a.status='cancelled' then return; end if;
  if a.ends_at<=now() or a.status not in('assigned','accepted','declined') then raise exception 'Only upcoming or active coverage can be cancelled'; end if;
  update public.room_coverage_assignments set status='cancelled' where id=a.id;
  select profile_id into recipient from public.staff_members where id=a.staff_member_id;
  payload_value:=jsonb_build_object('screen','RoomRatios','roomId',a.classroom_id,'assignmentId',a.id);
  insert into public.notifications(daycare_id,profile_id,kind,title,body,payload)
    values(a.daycare_id,recipient,'coverage_cancelled','Room coverage cancelled','Your coverage assignment was cancelled by an administrator. Check the updated room schedule.',payload_value);
  insert into public.notification_outbox(daycare_id,recipient_id,channel,kind,title,body,payload,dedupe_key)
    values(a.daycare_id,recipient,'push','coverage_cancelled','Room coverage cancelled','Check the updated room schedule.',payload_value,'coverage-cancelled:'||a.id::text) on conflict do nothing;
end $$;
revoke all on function public.cancel_planned_room_coverage(uuid) from public,anon;
grant execute on function public.cancel_planned_room_coverage(uuid) to authenticated;
