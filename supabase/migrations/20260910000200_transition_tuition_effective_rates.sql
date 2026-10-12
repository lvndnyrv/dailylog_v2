-- Group 7e -> 6j handoff: a proposed transition rate is scheduled with the
-- move and becomes the child's effective rate only when the move is completed.
-- Existing invoice lines remain immutable historical records.

create table public.child_tuition_rates (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  classroom_id uuid references public.classrooms(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  effective_from date not null,
  effective_to date,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'effective', 'cancelled')),
  source_transition_plan_id uuid unique
    references public.room_transition_plans(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index child_tuition_rates_one_open_effective_idx
  on public.child_tuition_rates(child_id)
  where status = 'effective' and effective_to is null;
create index child_tuition_rates_center_date_idx
  on public.child_tuition_rates(daycare_id, effective_from, child_id);

create trigger child_tuition_rates_updated_at
  before update on public.child_tuition_rates
  for each row execute function public.update_updated_at();

alter table public.child_tuition_rates enable row level security;

create policy "permitted staff read child tuition rates"
  on public.child_tuition_rates for select
  using (
    public.is_staff()
    and public.has_permission('billing', 'view')
    and daycare_id = public.get_my_daycare_id()
  );

create policy "permitted staff manage child tuition rates"
  on public.child_tuition_rates for all
  using (
    public.is_staff()
    and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id()
  )
  with check (
    public.is_staff()
    and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id()
  );

create policy "parents read linked child tuition rates"
  on public.child_tuition_rates for select
  using (child_id in (select public.my_child_ids()));

create trigger audit_child_tuition_rates
  after insert or update or delete on public.child_tuition_rates
  for each row execute function public.audit_write();

create function public.sync_transition_tuition_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  plan public.room_transition_plans;
  rate_id uuid;
begin
  plan := case when tg_op = 'DELETE' then old else new end;

  if tg_op = 'DELETE' then
    update public.child_tuition_rates
    set status = 'cancelled', effective_to = null
    where source_transition_plan_id = plan.id and status = 'scheduled';
    return old;
  end if;

  if new.status = 'cancelled' or new.new_tuition_cents is null then
    update public.child_tuition_rates
    set status = 'cancelled', effective_to = null
    where source_transition_plan_id = plan.id and status = 'scheduled';
    return new;
  end if;

  insert into public.child_tuition_rates(
    daycare_id, child_id, classroom_id, amount_cents, currency,
    effective_from, status, source_transition_plan_id, created_by
  ) values (
    new.daycare_id, new.child_id, new.to_classroom_id, new.new_tuition_cents,
    new.currency, new.move_on,
    'scheduled',
    new.id, new.created_by
  )
  on conflict (source_transition_plan_id) do update set
    classroom_id = excluded.classroom_id,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    effective_from = excluded.effective_from,
    effective_to = null,
    status = 'scheduled'
  returning id into rate_id;

  if new.status = 'completed' then
    update public.child_tuition_rates
    set effective_to = new.move_on - 1
    where child_id = new.child_id
      and id <> rate_id
      and status = 'effective'
      and effective_to is null
      and effective_from < new.move_on;

    update public.child_tuition_rates
    set status = 'cancelled', effective_to = null
    where child_id = new.child_id
      and id <> rate_id
      and status = 'effective'
      and effective_to is null;

    update public.child_tuition_rates
    set status = 'effective'
    where id = rate_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_transition_tuition_rate() from public, anon, authenticated;

create trigger sync_transition_tuition_rate
  after insert or update or delete on public.room_transition_plans
  for each row execute function public.sync_transition_tuition_rate();

-- Existing open plans gain the same scheduled-rate record. Completed history is
-- intentionally not reconstructed: old invoices remain the source of truth.
insert into public.child_tuition_rates(
  daycare_id, child_id, classroom_id, amount_cents, currency,
  effective_from, status, source_transition_plan_id, created_by
)
select
  plan.daycare_id, plan.child_id, plan.to_classroom_id, plan.new_tuition_cents,
  plan.currency, plan.move_on, 'scheduled', plan.id, plan.created_by
from public.room_transition_plans plan
where plan.status = 'planned' and plan.new_tuition_cents is not null
on conflict (source_transition_plan_id) do nothing;
