-- Admin web Group 13 — auditable report schedules and export history.

create table public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  report_kind text not null check (report_kind in (
    'attendance','billing','ratio','timesheets','incidents','enrollment'
  )),
  cadence text not null check (cadence in ('weekly','monthly','quarterly')),
  delivery_day integer not null check (delivery_day between 0 and 31),
  delivery_time time not null default '07:00',
  recipient_ids uuid[] not null default array[auth.uid()]::uuid[],
  formats text[] not null default array['pdf']::text[],
  skip_empty boolean not null default false,
  active boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(recipient_ids) > 0),
  check (formats <@ array['pdf','csv']::text[] and cardinality(formats) > 0)
);

create index report_schedules_center_next_idx
  on public.report_schedules(daycare_id, active, next_run_at);

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  report_kind text not null check (report_kind in (
    'attendance','billing','ratio','timesheets','incidents','enrollment'
  )),
  title text not null,
  starts_on date,
  ends_on date,
  format text not null check (format in ('pdf','csv')),
  parameters jsonb not null default '{}'::jsonb,
  row_count integer check (row_count is null or row_count >= 0),
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 years')
);

create index report_exports_center_generated_idx
  on public.report_exports(daycare_id, generated_at desc);

alter table public.report_schedules enable row level security;
alter table public.report_exports enable row level security;

create policy "permitted staff read report schedules"
  on public.report_schedules for select to authenticated
  using (daycare_id=public.get_my_daycare_id() and public.has_permission('reports','view'));
create policy "permitted staff create report schedules"
  on public.report_schedules for insert to authenticated
  with check (
    daycare_id=public.get_my_daycare_id()
    and created_by=auth.uid()
    and public.has_permission('reports','edit')
  );
create policy "permitted staff update report schedules"
  on public.report_schedules for update to authenticated
  using (daycare_id=public.get_my_daycare_id() and public.has_permission('reports','edit'))
  with check (daycare_id=public.get_my_daycare_id() and public.has_permission('reports','edit'));
create policy "permitted staff delete report schedules"
  on public.report_schedules for delete to authenticated
  using (daycare_id=public.get_my_daycare_id() and public.has_permission('reports','edit'));

create policy "permitted staff read report exports"
  on public.report_exports for select to authenticated
  using (daycare_id=public.get_my_daycare_id() and public.has_permission('reports','view'));
create policy "permitted staff record report exports"
  on public.report_exports for insert to authenticated
  with check (
    daycare_id=public.get_my_daycare_id()
    and created_by=auth.uid()
    and public.has_permission('reports','view')
  );

create trigger report_schedules_updated_at before update on public.report_schedules
  for each row execute function public.update_updated_at();

create function public.validate_report_schedule()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists (
    select 1 from unnest(new.recipient_ids) recipient_id
    left join public.profiles p on p.id=recipient_id
    where p.id is null or p.daycare_id<>new.daycare_id
      or p.role not in ('owner_admin','admin') or p.archived_at is not null
  ) then
    raise exception 'Every recipient must be an active administrator at this center';
  end if;
  return new;
end $$;
create trigger validate_report_schedule_before_write
  before insert or update on public.report_schedules
  for each row execute function public.validate_report_schedule();

create function public.audit_report_group13()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_action text;
begin
  v_action:=case
    when tg_table_name='report_exports' then 'report.exported'
    when tg_op='INSERT' then 'report_schedule.created'
    when tg_op='DELETE' then 'report_schedule.deleted'
    else 'report_schedule.updated' end;
  if tg_op='DELETE' then
    insert into public.audit_log(daycare_id,actor_id,action,entity_type,entity_id,before)
    values(old.daycare_id,auth.uid(),v_action,tg_table_name,old.id,to_jsonb(old));
    return old;
  end if;
  insert into public.audit_log(daycare_id,actor_id,action,entity_type,entity_id,before,after)
  values(new.daycare_id,auth.uid(),v_action,tg_table_name,new.id,
    case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new));
  return new;
end $$;
create trigger audit_report_schedules
  after insert or update or delete on public.report_schedules
  for each row execute function public.audit_report_group13();
create trigger audit_report_exports
  after insert on public.report_exports
  for each row execute function public.audit_report_group13();

revoke all on public.report_schedules,public.report_exports from anon;
grant select,insert,update,delete on public.report_schedules to authenticated;
grant select,insert on public.report_exports to authenticated;
revoke all on function public.validate_report_schedule(),public.audit_report_group13()
  from public,anon,authenticated;
