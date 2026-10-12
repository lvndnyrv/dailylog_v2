-- pg_cron sessions do not carry PostgREST JWT claims. Supply a transaction-
-- local service-role claim so the private maintenance functions retain their
-- fail-closed caller checks when invoked by the database scheduler.

do $$
declare
  v_job bigint;
begin
  select jobid into v_job
  from cron.job
  where jobname = 'dailylog-credential-reminders';
  if v_job is not null then perform cron.unschedule(v_job); end if;

  perform cron.schedule(
    'dailylog-credential-reminders',
    '5 * * * *',
    $cron$
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      select public.enqueue_staff_credential_expiry_reminders();
    $cron$
  );

  select jobid into v_job
  from cron.job
  where jobname = 'dailylog-compliance-reminders';
  if v_job is not null then perform cron.unschedule(v_job); end if;

  perform cron.schedule(
    'dailylog-compliance-reminders',
    '10 * * * *',
    $cron$
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      select public.enqueue_compliance_due_reminders();
    $cron$
  );
end;
$$;
