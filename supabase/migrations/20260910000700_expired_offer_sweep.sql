-- Expired offers must release their hold even when nobody reopens the bearer
-- link. A background sweep closes them and the existing release trigger puts
-- eligible successor families into administrator review.

create or replace function public.capture_closed_offer_vacancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
  v_available_on date;
begin
  if old.offer_status in ('sent', 'viewed', 'accepted')
     and new.offer_status in ('declined', 'expired', 'withdrawn')
     and new.classroom_id is not null then
    -- An expired family remains on file and can be offered another future
    -- opening, but it must not remain displayed as an open room hold.
    if new.offer_status = 'expired' and new.waitlist_status = 'offer' then
      update public.enrollments
         set stage = 'inquiry',
             stage_changed_at = now(),
             waitlist_status = 'active'
       where id = new.id;
    end if;

    if coalesce((
      select settings.auto_offer
        from public.enrollment_settings settings
       where settings.daycare_id = new.daycare_id
    ), true) then
      select (now() at time zone coalesce(center.timezone, 'UTC'))::date
        into v_today
        from public.daycares center
       where center.id = new.daycare_id;

      v_available_on := public._next_center_open_on_or_after(
        new.daycare_id,
        greatest(coalesce(v_today, current_date), coalesce(old.desired_start_date, v_today, current_date))
      );

      insert into public.room_vacancy_reviews (
        daycare_id,
        classroom_id,
        source_enrollment_id,
        source_offer_sent_at,
        release_reason,
        available_on
      ) values (
        new.daycare_id,
        new.classroom_id,
        new.id,
        coalesce(old.offer_sent_at, old.stage_changed_at, old.updated_at, now()),
        new.offer_status,
        coalesce(v_available_on, greatest(coalesce(v_today, current_date), coalesce(old.desired_start_date, v_today, current_date)))
      )
      on conflict (source_enrollment_id, source_offer_sent_at)
        where source_enrollment_id is not null
        do nothing;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.process_expired_enrollment_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_worker boolean := auth.role() = 'service_role'
    or (auth.uid() is null and auth.role() is null);
  v_target_center uuid;
  v_changed integer;
  v_total integer := 0;
begin
  if not v_worker and (
    auth.uid() is null
    or not public.is_admin()
    or not public.has_permission('enrollment', 'edit')
  ) then
    raise exception 'Administrator enrollment-edit permission required';
  end if;

  for v_target_center in
    select distinct enrollment.daycare_id
      from public.enrollments enrollment
     where enrollment.offer_status in ('sent', 'viewed')
       and enrollment.offer_expires_at is not null
       and enrollment.offer_expires_at <= now()
       and (v_worker or enrollment.daycare_id = v_center_id)
     order by enrollment.daycare_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_target_center::text, 0));

    update public.enrollments enrollment
       set offer_status = 'expired'
     where enrollment.daycare_id = v_target_center
       and enrollment.offer_status in ('sent', 'viewed')
       and enrollment.offer_expires_at is not null
       and enrollment.offer_expires_at <= now();
    get diagnostics v_changed = row_count;
    v_total := v_total + v_changed;

    perform public.reindex_center_waitlist(v_target_center);
  end loop;

  return v_total;
end;
$$;

revoke all on function public.process_expired_enrollment_offers()
  from public, anon;
grant execute on function public.process_expired_enrollment_offers()
  to authenticated, service_role;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job
   where jobname = 'dailylog-expired-enrollment-offers';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'dailylog-expired-enrollment-offers',
    '*/5 * * * *',
    'select public.process_expired_enrollment_offers();'
  );
end;
$$;

notify pgrst, 'reload schema';
