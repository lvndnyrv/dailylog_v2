-- Auditable room-ratio history. State changes are stored as immutable time
-- intervals; a one-minute sweep catches time-bound coverage ending even when
-- no attendance or clock event occurs at that exact moment.

create table public.room_ratio_history (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz,
  present_count integer not null check (present_count >= 0),
  staff_count integer not null check (staff_count >= 0),
  required_staff integer not null check (required_staff >= 0),
  max_children_per_staff integer not null check (max_children_per_staff > 0),
  source text not null check (source in (
    'attendance','staff_time','coverage','room_rule','scheduled_sweep','legacy_event'
  )),
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create unique index room_ratio_history_one_open_room_idx
  on public.room_ratio_history(classroom_id) where ends_at is null;
create index room_ratio_history_center_time_idx
  on public.room_ratio_history(daycare_id, starts_at desc);
create index room_ratio_history_room_time_idx
  on public.room_ratio_history(classroom_id, starts_at desc);

alter table public.room_ratio_history enable row level security;
create policy "staff read own ratio history" on public.room_ratio_history
  for select to authenticated
  using (public.is_staff() and daycare_id=public.get_my_daycare_id());
revoke insert,update,delete on public.room_ratio_history from anon,authenticated;

create function public._record_room_ratio_history(
  p_classroom_id uuid,
  p_observed_at timestamptz default clock_timestamp(),
  p_source text default 'scheduled_sweep'
)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_room public.classrooms%rowtype;
  v_center public.daycares%rowtype;
  v_snapshot record;
  v_open public.room_ratio_history%rowtype;
  v_local timestamp;
  v_day date;
  v_opens timestamptz;
  v_closes timestamptz;
  v_operating boolean;
  v_previous_close timestamptz;
begin
  if p_classroom_id is null or p_source not in
    ('attendance','staff_time','coverage','room_rule','scheduled_sweep','legacy_event') then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ratio-history:'||p_classroom_id::text,0));
  select * into v_room from public.classrooms
    where id=p_classroom_id and archived_at is null;
  if not found then
    update public.room_ratio_history set ends_at=p_observed_at
      where classroom_id=p_classroom_id and ends_at is null and starts_at<p_observed_at;
    return;
  end if;
  select * into v_center from public.daycares where id=v_room.daycare_id;
  v_local := p_observed_at at time zone coalesce(v_center.timezone,'UTC');
  v_day := v_local::date;
  v_opens := (v_day+v_center.opens_at) at time zone coalesce(v_center.timezone,'UTC');
  v_closes := (v_day+v_center.closes_at) at time zone coalesce(v_center.timezone,'UTC');
  v_operating := p_observed_at>=v_opens and p_observed_at<v_closes and not exists(
    select 1 from public.center_closures c
      where c.daycare_id=v_room.daycare_id and v_day between c.starts_on and c.ends_on
  );

  select * into v_open from public.room_ratio_history
    where classroom_id=p_classroom_id and ends_at is null for update;
  if found and (v_open.starts_at at time zone coalesce(v_center.timezone,'UTC'))::date<v_day then
    v_previous_close := (((v_open.starts_at at time zone coalesce(v_center.timezone,'UTC'))::date)
      +v_center.closes_at) at time zone coalesce(v_center.timezone,'UTC');
    update public.room_ratio_history set ends_at=greatest(starts_at+interval '1 microsecond',v_previous_close)
      where id=v_open.id;
    v_open.id := null;
  end if;
  if not v_operating then
    if v_open.id is not null then
      update public.room_ratio_history set ends_at=greatest(starts_at+interval '1 microsecond',
        case when p_observed_at>=v_closes then v_closes else p_observed_at end)
        where id=v_open.id;
    end if;
    return;
  end if;

  select * into v_snapshot from public._room_ratio_snapshot(p_classroom_id);
  if v_snapshot is null then return; end if;
  if v_open.id is not null
    and v_open.present_count=v_snapshot.present_count
    and v_open.staff_count=v_snapshot.staff_count
    and v_open.required_staff=v_snapshot.required_staff
    and v_open.max_children_per_staff=v_snapshot.max_children_per_staff then
    return;
  end if;
  if v_open.id is not null then
    if v_open.starts_at=p_observed_at then
      update public.room_ratio_history set
        present_count=v_snapshot.present_count,staff_count=v_snapshot.staff_count,
        required_staff=v_snapshot.required_staff,
        max_children_per_staff=v_snapshot.max_children_per_staff,
        source=p_source,recorded_by=auth.uid()
      where id=v_open.id;
      return;
    end if;
    update public.room_ratio_history set ends_at=p_observed_at where id=v_open.id;
  end if;
  insert into public.room_ratio_history(daycare_id,classroom_id,starts_at,present_count,
    staff_count,required_staff,max_children_per_staff,source,recorded_by)
  values(v_room.daycare_id,p_classroom_id,p_observed_at,v_snapshot.present_count,
    v_snapshot.staff_count,v_snapshot.required_staff,v_snapshot.max_children_per_staff,
    p_source,auth.uid());
end $$;

create function public.refresh_ratio_history_after_attendance()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_old_room uuid;v_new_room uuid;
begin
  if tg_op<>'INSERT' then select classroom_id into v_old_room from public.children where id=old.child_id; end if;
  if tg_op<>'DELETE' then select classroom_id into v_new_room from public.children where id=new.child_id; end if;
  perform public._record_room_ratio_history(v_old_room,clock_timestamp(),'attendance');
  if v_new_room is distinct from v_old_room then perform public._record_room_ratio_history(v_new_room,clock_timestamp(),'attendance'); end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger zz_attendance_refresh_ratio_history after insert or update or delete on public.attendance_records
  for each row execute function public.refresh_ratio_history_after_attendance();

create function public.refresh_ratio_history_after_coverage()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_staff uuid;v_primary uuid;v_old uuid;v_new uuid;
begin
  if tg_op<>'INSERT' then v_staff:=old.staff_member_id;v_old:=old.classroom_id; end if;
  if tg_op<>'DELETE' then v_staff:=new.staff_member_id;v_new:=new.classroom_id; end if;
  select p.classroom_id into v_primary from public.staff_members s join public.profiles p on p.id=s.profile_id where s.id=v_staff;
  perform public._record_room_ratio_history(v_old,clock_timestamp(),'coverage');
  if v_new is distinct from v_old then perform public._record_room_ratio_history(v_new,clock_timestamp(),'coverage'); end if;
  if v_primary is distinct from v_old and v_primary is distinct from v_new then
    perform public._record_room_ratio_history(v_primary,clock_timestamp(),'coverage');
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger zz_coverage_refresh_ratio_history after insert or update or delete on public.room_coverage_assignments
  for each row execute function public.refresh_ratio_history_after_coverage();

create function public.refresh_ratio_history_after_staff_time()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_staff uuid;v_primary uuid;v_old uuid;v_new uuid;
begin
  if tg_op<>'INSERT' then v_staff:=old.staff_member_id;v_old:=old.classroom_id; end if;
  if tg_op<>'DELETE' then v_staff:=new.staff_member_id;v_new:=new.classroom_id; end if;
  select p.classroom_id into v_primary from public.staff_members s join public.profiles p on p.id=s.profile_id where s.id=v_staff;
  perform public._record_room_ratio_history(v_old,clock_timestamp(),'staff_time');
  if v_new is distinct from v_old then perform public._record_room_ratio_history(v_new,clock_timestamp(),'staff_time'); end if;
  if v_primary is distinct from v_old and v_primary is distinct from v_new then
    perform public._record_room_ratio_history(v_primary,clock_timestamp(),'staff_time');
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger zz_staff_time_refresh_ratio_history after insert or update or delete on public.staff_time_entries
  for each row execute function public.refresh_ratio_history_after_staff_time();

create function public.refresh_ratio_history_after_room_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='children' then
    perform public._record_room_ratio_history(old.classroom_id,clock_timestamp(),'attendance');
    if new.classroom_id is distinct from old.classroom_id then
      perform public._record_room_ratio_history(new.classroom_id,clock_timestamp(),'attendance');
    end if;
  else
    perform public._record_room_ratio_history(new.id,clock_timestamp(),'room_rule');
  end if;
  return new;
end $$;
create trigger zz_child_room_refresh_ratio_history after update of classroom_id on public.children
  for each row when (old.classroom_id is distinct from new.classroom_id)
  execute function public.refresh_ratio_history_after_room_change();
create trigger zz_room_rule_refresh_ratio_history
  after update of ratio_children_per_educator,archived_at on public.classrooms
  for each row execute function public.refresh_ratio_history_after_room_change();

create function public.process_room_ratio_history()
returns integer language plpgsql security definer set search_path=public as $$
declare v_room record;v_count integer:=0;
begin
  for v_room in select id from public.classrooms where archived_at is null loop
    perform public._record_room_ratio_history(v_room.id,clock_timestamp(),'scheduled_sweep');
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public._record_room_ratio_history(uuid,timestamptz,text),
  public.process_room_ratio_history() from public,anon,authenticated;
grant execute on function public.process_room_ratio_history() to service_role;

-- Preserve the only historical facts available before this ledger: recorded
-- over-ratio events. They are explicitly labelled rather than presented as a
-- complete compliant-day history.
insert into public.room_ratio_history(daycare_id,classroom_id,starts_at,ends_at,
  present_count,staff_count,required_staff,max_children_per_staff,source)
select e.daycare_id,e.classroom_id,e.started_at,coalesce(e.resolved_at,clock_timestamp()),
  e.peak_present,e.minimum_staff,e.required_staff,greatest(c.ratio_children_per_educator,1),'legacy_event'
from public.room_ratio_events e join public.classrooms c on c.id=e.classroom_id
where e.started_at<clock_timestamp() and coalesce(e.resolved_at,clock_timestamp())>e.started_at;
select public.process_room_ratio_history();

do $$ declare v_job bigint;begin
  select jobid into v_job from cron.job where jobname='dailylog-room-ratio-history';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('dailylog-room-ratio-history','* * * * *',
    'select public.process_room_ratio_history();');
end $$;

create function public._compliance_ratio_ledger(p_daycare uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  with bounds as (
    select coalesce(d.timezone,'UTC') zone,d.opens_at,d.closes_at,
      (now() at time zone coalesce(d.timezone,'UTC'))::date today
    from public.daycares d where d.id=p_daycare
  ), base as (
    select h.*,c.name room,least(coalesce(h.ends_at,now()),now()) effective_end
    from public.room_ratio_history h join public.classrooms c on c.id=h.classroom_id,bounds b
    where h.daycare_id=p_daycare and (h.ends_at is null or h.ends_at>=(b.today-90)::timestamp at time zone b.zone)
  ), rows as (
    select * from base order by starts_at desc limit 5000
  ), totals as (
    select coalesce(floor(sum(extract(epoch from (effective_end-greatest(starts_at,
      (b.today-30)::timestamp at time zone b.zone)))/60)
      filter(where effective_end>greatest(starts_at,(b.today-30)::timestamp at time zone b.zone))),0)::int observed,
      coalesce(floor(sum(extract(epoch from (effective_end-greatest(starts_at,
      (b.today-30)::timestamp at time zone b.zone)))/60)
      filter(where effective_end>greatest(starts_at,(b.today-30)::timestamp at time zone b.zone)
        and staff_count>=required_staff)),0)::int compliant
    from base,bounds b
  )
  select jsonb_build_object(
    'captured_since',(select min(starts_at) from public.room_ratio_history where daycare_id=p_daycare),
    'opens_at',to_char(b.opens_at,'HH24:MI'),'closes_at',to_char(b.closes_at,'HH24:MI'),
    'observed_minutes',t.observed,'compliant_minutes',t.compliant,
    'over_minutes',greatest(t.observed-t.compliant,0),
    'intervals',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'room',r.room,
      'starts_at',r.starts_at,'ends_at',r.ends_at,'present_count',r.present_count,
      'staff_count',r.staff_count,'required_staff',r.required_staff,
      'max_children_per_staff',r.max_children_per_staff,'source',r.source) order by r.starts_at desc)
      from rows r),'[]'::jsonb)
  ) from bounds b cross join totals t;
$$;
revoke all on function public._compliance_ratio_ledger(uuid) from public,anon,authenticated;

create or replace function public.get_compliance_inspection_pack()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_access_compliance() then raise exception 'Compliance requires an active admin with staff, incidents, attendance and report access'; end if;
  return public._compliance_inspection_pack(public.get_my_daycare_id())
    ||jsonb_build_object('ratio_ledger',public._compliance_ratio_ledger(public.get_my_daycare_id()));
end $$;
create or replace function public.read_compliance_inspection_share(p_token text,p_document_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_daycare uuid;v_result jsonb;
begin
  if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception 'This inspection link is unavailable or expired'; end if;
  select s.daycare_id into v_daycare from public.compliance_inspection_shares s
    where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now()
      and public._compliance_profile_access(s.created_by,s.daycare_id,true);
  if v_daycare is null then raise exception 'This inspection link is unavailable or expired'; end if;
  v_result:=public._read_compliance_inspection_share(p_token,p_document_id);
  if p_document_id is not null then return v_result; end if;
  return v_result||jsonb_build_object('ratio_ledger',public._compliance_ratio_ledger(v_daycare));
end $$;
revoke all on function public.read_compliance_inspection_share(text,uuid) from public;
grant execute on function public.read_compliance_inspection_share(text,uuid) to anon,authenticated,service_role;

notify pgrst,'reload schema';
