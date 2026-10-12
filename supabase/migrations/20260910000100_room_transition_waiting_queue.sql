-- Group 7e: persist children waiting for a room and promote a reviewed request
-- into the existing dated transition workflow without reserving a place early.

create table public.room_transition_wait_requests (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  from_classroom_id uuid not null references public.classrooms(id) on delete cascade,
  to_classroom_id uuid not null references public.classrooms(id) on delete cascade,
  not_before date not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'planned', 'cancelled')),
  converted_plan_id uuid references public.room_transition_plans(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_classroom_id <> to_classroom_id),
  check (length(coalesce(notes, '')) <= 2000),
  check ((status = 'planned') = (converted_plan_id is not null))
);

create unique index room_transition_wait_requests_one_active_child_idx
  on public.room_transition_wait_requests(child_id) where status = 'waiting';
create index room_transition_wait_requests_center_date_idx
  on public.room_transition_wait_requests(daycare_id, not_before) where status = 'waiting';

create trigger room_transition_wait_requests_updated_at
  before update on public.room_transition_wait_requests
  for each row execute function public.update_updated_at();

alter table public.room_transition_wait_requests enable row level security;

create policy "staff read room transition wait requests"
  on public.room_transition_wait_requests for select
  using (public.is_staff() and daycare_id = public.get_my_daycare_id());

create policy "admins manage room transition wait requests"
  on public.room_transition_wait_requests for all
  using (
    public.is_admin()
    and public.has_permission('children', 'edit')
    and daycare_id = public.get_my_daycare_id()
  )
  with check (
    public.is_admin()
    and public.has_permission('children', 'edit')
    and daycare_id = public.get_my_daycare_id()
  );

create trigger audit_room_transition_wait_requests
  after insert or update or delete on public.room_transition_wait_requests
  for each row execute function public.audit_write();

create function public.get_room_transition_wait_requests()
returns table(
  id uuid,
  updated_at timestamptz,
  child_id uuid,
  first_name text,
  last_name text,
  date_of_birth date,
  age_months integer,
  from_classroom_id uuid,
  from_room_name text,
  source_max_age_months integer,
  to_classroom_id uuid,
  to_room_name text,
  not_before date,
  first_available_day date,
  projected_children integer,
  room_capacity integer,
  needs_review boolean,
  status_detail text,
  notes text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    wait.id,
    wait.updated_at,
    wait.child_id,
    child.first_name,
    child.last_name,
    child.date_of_birth,
    case when child.date_of_birth is null then null else
      (extract(year from age(public.center_today(), child.date_of_birth)) * 12
        + extract(month from age(public.center_today(), child.date_of_birth)))::integer
    end,
    wait.from_classroom_id,
    source.name,
    source.max_age_months,
    wait.to_classroom_id,
    destination.name,
    wait.not_before,
    opening.day,
    opening.projected_children,
    destination.capacity,
    child.archived_at is not null
      or child.classroom_id is distinct from wait.from_classroom_id
      or source.archived_at is not null
      or destination.archived_at is not null
      or child.date_of_birth is null
      or destination.min_age_months is null
      or destination.max_age_months is null,
    case
      when child.archived_at is not null then 'Child is no longer active'
      when child.classroom_id is distinct from wait.from_classroom_id then 'Child''s current room changed'
      when source.archived_at is not null then 'Starting room is archived'
      when destination.archived_at is not null then 'Destination room is archived'
      when child.date_of_birth is null then 'Birth date needs review'
      when destination.min_age_months is null or destination.max_age_months is null then 'Destination age band needs review'
      when opening.day is not null then 'First projected opening found'
      else 'No safe opening is projected in the next year'
    end,
    wait.notes
  from public.room_transition_wait_requests wait
  join public.children child on child.id = wait.child_id
  join public.classrooms source on source.id = wait.from_classroom_id
  join public.classrooms destination on destination.id = wait.to_classroom_id
  left join lateral (
    select candidate.day, capacity.projected_children
    from generate_series(
      greatest(wait.not_before, public.center_today()),
      public.center_today() + 365,
      interval '1 day'
    ) generated(day_value)
    cross join lateral (
      select generated.day_value::date as day
    ) candidate
    cross join lateral public._room_transition_capacity(
      destination.id,
      child.id,
      candidate.day
    ) capacity
    where child.archived_at is null
      and child.classroom_id = wait.from_classroom_id
      and source.archived_at is null
      and destination.archived_at is null
      and destination.capacity is not null
      and destination.capacity > 0
      and child.date_of_birth is not null
      and destination.min_age_months is not null
      and destination.max_age_months is not null
      and (destination.opens_on is null or destination.opens_on <= candidate.day)
      and extract(isodow from candidate.day) <= 5
      and not exists (
        select 1 from public.center_closures closure
        where closure.daycare_id = wait.daycare_id
          and candidate.day between closure.starts_on and closure.ends_on
      )
      and candidate.day >= (
        child.date_of_birth + make_interval(months => destination.min_age_months)
      )::date
      and candidate.day < (
        child.date_of_birth + make_interval(months => destination.max_age_months)
      )::date
      and capacity.projected_children < destination.capacity
    order by candidate.day
    limit 1
  ) opening on true
  where wait.daycare_id = public.get_my_daycare_id()
    and public.is_admin()
    and public.has_permission('children', 'view')
    and wait.status = 'waiting'
  order by coalesce(opening.day, wait.not_before), child.first_name, child.last_name;
$$;

revoke all on function public.get_room_transition_wait_requests() from public, anon;
grant execute on function public.get_room_transition_wait_requests() to authenticated;

create function public.save_room_transition_wait_request(
  p_settings jsonb,
  p_request_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  center uuid := public.get_my_daycare_id();
  child public.children;
  destination public.classrooms;
  request public.room_transition_wait_requests;
  earliest date;
  result uuid;
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('children', 'edit') then
    raise exception 'Administrator children-edit permission required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(center::text, 0));

  select * into child from public.children
  where id = (p_settings->>'child_id')::uuid
    and daycare_id = center
    and archived_at is null
  for update;
  if child.id is null or child.classroom_id is distinct from (p_settings->>'from_room_id')::uuid then
    raise exception 'The child is no longer in the starting room';
  end if;

  select * into destination from public.classrooms
  where id = (p_settings->>'to_room_id')::uuid
    and daycare_id = center
    and archived_at is null
  for update;
  if destination.id is null or destination.id = child.classroom_id then
    raise exception 'Choose a different active destination room';
  end if;
  if child.date_of_birth is null or destination.min_age_months is null or destination.max_age_months is null then
    raise exception 'Add the child birth date and destination age band before starting a wait';
  end if;

  earliest := (p_settings->>'not_before')::date;
  if earliest is null or earliest < public.center_today() or earliest > public.center_today() + 365 then
    raise exception 'Choose an earliest move date within the next year';
  end if;
  if length(coalesce(p_settings->>'notes', '')) > 2000 then
    raise exception 'Notes must be at most 2000 characters';
  end if;
  if exists (
    select 1 from public.room_transition_plans plan
    where plan.child_id = child.id and plan.status = 'planned'
  ) then
    raise exception 'This child already has a planned move';
  end if;

  if p_request_id is null then
    if exists (
      select 1 from public.room_transition_wait_requests wait
      where wait.child_id = child.id and wait.status = 'waiting'
    ) then
      raise exception 'This child already has a waiting request. Close and reopen it before editing';
    end if;
    insert into public.room_transition_wait_requests(
      daycare_id, child_id, from_classroom_id, to_classroom_id, not_before, notes
    ) values (
      center, child.id, child.classroom_id, destination.id, earliest,
      nullif(btrim(p_settings->>'notes'), '')
    ) returning id into result;
  else
    select * into request from public.room_transition_wait_requests
    where id = p_request_id and child_id = child.id and daycare_id = center
    for update;
    if request.id is null or request.status <> 'waiting' then
      raise exception 'This waiting request is no longer available';
    end if;
    if p_expected_updated_at is null or request.updated_at is distinct from p_expected_updated_at then
      raise exception 'This waiting request changed. Close and reopen it before saving';
    end if;
    update public.room_transition_wait_requests
    set to_classroom_id = destination.id,
        not_before = earliest,
        notes = nullif(btrim(p_settings->>'notes'), '')
    where id = request.id
    returning id into result;
  end if;
  return result;
end;
$$;

revoke all on function public.save_room_transition_wait_request(jsonb, uuid, timestamptz) from public, anon;
grant execute on function public.save_room_transition_wait_request(jsonb, uuid, timestamptz) to authenticated;

create function public.cancel_room_transition_wait_request(
  p_request_id uuid,
  p_expected_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare request public.room_transition_wait_requests;
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('children', 'edit') then
    raise exception 'Administrator children-edit permission required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(public.get_my_daycare_id()::text, 0));
  select * into request from public.room_transition_wait_requests
  where id = p_request_id and daycare_id = public.get_my_daycare_id()
  for update;
  if request.id is null then raise exception 'Waiting request not found'; end if;
  if request.status = 'cancelled' then return; end if;
  if request.status <> 'waiting' then raise exception 'Only an active waiting request can be cancelled'; end if;
  if p_expected_updated_at is null or request.updated_at is distinct from p_expected_updated_at then
    raise exception 'This waiting request changed. Close and reopen it before cancelling';
  end if;
  update public.room_transition_wait_requests set status = 'cancelled' where id = request.id;
end;
$$;

revoke all on function public.cancel_room_transition_wait_request(uuid, timestamptz) from public, anon;
grant execute on function public.cancel_room_transition_wait_request(uuid, timestamptz) to authenticated;

create function public.convert_room_transition_wait_to_plan(
  p_request_id uuid,
  p_expected_updated_at timestamptz,
  p_settings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request public.room_transition_wait_requests;
  plan_id uuid;
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('children', 'edit') then
    raise exception 'Administrator children-edit permission required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(public.get_my_daycare_id()::text, 0));
  select * into request from public.room_transition_wait_requests
  where id = p_request_id and daycare_id = public.get_my_daycare_id()
  for update;
  if request.id is null or request.status <> 'waiting' then
    raise exception 'This waiting request is no longer available';
  end if;
  if p_expected_updated_at is null or request.updated_at is distinct from p_expected_updated_at then
    raise exception 'This waiting request changed. Close and reopen it before scheduling';
  end if;
  if (p_settings->>'child_id')::uuid <> request.child_id
    or (p_settings->>'from_room_id')::uuid <> request.from_classroom_id
    or (p_settings->>'to_room_id')::uuid <> request.to_classroom_id then
    raise exception 'The reviewed waiting request no longer matches this move';
  end if;
  if (p_settings->>'move_on')::date < request.not_before then
    raise exception 'The move cannot be scheduled before the requested date';
  end if;

  -- Moving the request out of the active set first allows the existing plan
  -- function to run. Any later error rolls this update back atomically.
  update public.room_transition_wait_requests
  set status = 'cancelled'
  where id = request.id;

  plan_id := public.save_room_transition_plan(p_settings);

  update public.room_transition_wait_requests
  set status = 'planned', converted_plan_id = plan_id
  where id = request.id;
  return plan_id;
end;
$$;

revoke all on function public.convert_room_transition_wait_to_plan(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.convert_room_transition_wait_to_plan(uuid, timestamptz, jsonb) to authenticated;

create function public.resolve_room_transition_wait_on_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.room_transition_wait_requests
  set status = 'planned', converted_plan_id = new.id
  where child_id = new.child_id and status = 'waiting';
  return new;
end;
$$;

revoke all on function public.resolve_room_transition_wait_on_plan() from public, anon, authenticated;

create trigger resolve_room_transition_wait_on_plan
  after insert on public.room_transition_plans
  for each row when (new.status = 'planned')
  execute function public.resolve_room_transition_wait_on_plan();
