-- Group 2f -> Billing: an accepted tuition amount becomes a durable child rate
-- on the agreed first day. Existing invoice history is never rewritten.

alter table public.child_tuition_rates
  add column if not exists source_enrollment_id uuid
    references public.enrollments(id) on delete set null;

create unique index if not exists child_tuition_rates_source_enrollment_idx
  on public.child_tuition_rates(source_enrollment_id)
  where source_enrollment_id is not null;

create or replace function public.sync_enrollment_tuition_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
  v_rate_id uuid;
  v_status text;
  v_previous public.child_tuition_rates%rowtype;
begin
  select (now() at time zone coalesce(daycare.timezone, 'UTC'))::date
    into v_today
    from public.daycares daycare
   where daycare.id = new.daycare_id;

  if new.stage <> 'enrolled' or new.child_id is null or new.desired_start_date is null then
    if old.stage = 'enrolled' and new.stage <> 'enrolled' then
      update public.child_tuition_rates rate
         set status = case when rate.status = 'scheduled' then 'cancelled' else rate.status end,
             effective_to = case
               when rate.status = 'effective' and rate.effective_to is null
                 then greatest(rate.effective_from, v_today)
               else rate.effective_to
             end
       where rate.source_enrollment_id = new.id;
    end if;
    return new;
  end if;

  if coalesce(new.offer_tuition_cents, 0) = 0 then
    update public.child_tuition_rates
       set status = 'cancelled', effective_to = null
     where source_enrollment_id = new.id and status = 'scheduled';
    update public.enrollments
       set onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
         || jsonb_build_object(
           'billing_status', 'no_charge',
           'billing_starts_on', new.desired_start_date,
           'billing_amount_cents', 0
         )
     where id = new.id;
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.child_id::text || ':tuition', 0));
  v_status := case when new.desired_start_date <= v_today then 'effective' else 'scheduled' end;

  select * into v_previous
    from public.child_tuition_rates rate
   where rate.source_enrollment_id = new.id
   for update;

  if v_status = 'effective' then
    update public.child_tuition_rates rate
       set effective_to = greatest(rate.effective_from, new.desired_start_date - 1)
     where rate.child_id = new.child_id
       and rate.status = 'effective'
       and rate.effective_to is null
       and rate.id is distinct from v_previous.id;
  end if;

  insert into public.child_tuition_rates (
    daycare_id, child_id, classroom_id, amount_cents, currency,
    effective_from, effective_to, status, source_enrollment_id, created_by
  ) values (
    new.daycare_id, new.child_id, new.classroom_id, new.offer_tuition_cents, 'CAD',
    new.desired_start_date, null, v_status, new.id, auth.uid()
  )
  on conflict (source_enrollment_id) where source_enrollment_id is not null
  do update set
    child_id = excluded.child_id,
    classroom_id = excluded.classroom_id,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    effective_from = excluded.effective_from,
    effective_to = null,
    status = excluded.status
  returning id into v_rate_id;

  update public.enrollments
     set onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
       || jsonb_build_object(
         'billing_status', v_status,
         'billing_starts_on', new.desired_start_date,
         'billing_amount_cents', new.offer_tuition_cents,
         'tuition_rate_id', v_rate_id
       )
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_enrollment_tuition_rate on public.enrollments;
create trigger sync_enrollment_tuition_rate
  after insert or update of stage, child_id, classroom_id, desired_start_date, offer_tuition_cents
  on public.enrollments
  for each row execute function public.sync_enrollment_tuition_rate();

create or replace function public.activate_due_enrollment_tuition_rates(
  p_daycare_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker boolean := auth.role() = 'service_role'
    or (auth.uid() is null and auth.role() is null);
  v_center_id uuid;
  v_rate record;
  v_count integer := 0;
begin
  if not v_worker then
    if not public.is_admin() or not public.has_permission('billing', 'edit') then
      raise exception 'Administrator billing edit permission required';
    end if;
    v_center_id := public.get_my_daycare_id();
    if p_daycare_id is not null and p_daycare_id <> v_center_id then
      raise exception 'Cannot activate another center''s tuition';
    end if;
  else
    v_center_id := p_daycare_id;
  end if;

  for v_rate in
    select rate.*, enrollment.id as enrollment_id,
           (now() at time zone coalesce(daycare.timezone, 'UTC'))::date as center_day
      from public.child_tuition_rates rate
      join public.enrollments enrollment on enrollment.id = rate.source_enrollment_id
      join public.daycares daycare on daycare.id = rate.daycare_id
     where rate.status = 'scheduled'
       and rate.effective_to is null
       and enrollment.stage = 'enrolled'
       and enrollment.child_id = rate.child_id
       and (v_center_id is null or rate.daycare_id = v_center_id)
       and rate.effective_from <= (now() at time zone coalesce(daycare.timezone, 'UTC'))::date
     order by rate.daycare_id, rate.effective_from, rate.id
     for update of rate skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_rate.child_id::text || ':tuition', 0));
    update public.child_tuition_rates rate
       set effective_to = greatest(rate.effective_from, v_rate.effective_from - 1)
     where rate.child_id = v_rate.child_id
       and rate.status = 'effective'
       and rate.effective_to is null
       and rate.id <> v_rate.id;

    update public.child_tuition_rates
       set status = 'effective'
     where id = v_rate.id and status = 'scheduled';
    if found then
      update public.enrollments
         set onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
           || jsonb_build_object(
             'billing_status', 'effective',
             'billing_activated_on', v_rate.center_day,
             'billing_starts_on', v_rate.effective_from,
             'billing_amount_cents', v_rate.amount_cents,
             'tuition_rate_id', v_rate.id
           )
       where id = v_rate.enrollment_id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.sync_enrollment_tuition_rate()
  from public, anon, authenticated;
revoke all on function public.activate_due_enrollment_tuition_rates(uuid)
  from public, anon;
grant execute on function public.activate_due_enrollment_tuition_rates(uuid)
  to authenticated, service_role;

-- Backfill accepted enrollments without manufacturing invoices or changing any
-- existing historical tuition rate.
update public.enrollments enrollment
   set offer_tuition_cents = enrollment.offer_tuition_cents
 where enrollment.stage = 'enrolled'
   and enrollment.child_id is not null
   and enrollment.desired_start_date is not null;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job
   where jobname = 'dailylog-enrollment-tuition-activation';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'dailylog-enrollment-tuition-activation',
    '15 * * * *',
    'select public.activate_due_enrollment_tuition_rates();'
  );
end;
$$;

notify pgrst, 'reload schema';
