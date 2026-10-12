-- The mature coverage reconciliation introduced in 20260913000600 already
-- persists review_issue on the assignment, alerts the educator and permitted
-- administrators, and has its own scheduled worker. Retire the duplicate
-- October worker before it can produce duplicate production notifications.
do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'dailylog-coverage-review-alerts';
  if v_job is not null then perform cron.unschedule(v_job); end if;
end;
$$;

drop function if exists public.process_room_coverage_review_alerts();
drop function if exists public._coverage_assignment_review_reason(uuid);
drop table if exists public.room_coverage_review_alerts;
