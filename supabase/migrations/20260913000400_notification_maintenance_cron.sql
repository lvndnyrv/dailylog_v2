-- Reminder materialization is database-native work. Run it in pg_cron rather
-- than through the Edge Function's PostgREST connection so a gateway timeout
-- cannot delay either reminders or already-queued deliveries.

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
    'select public.enqueue_staff_credential_expiry_reminders();'
  );

  select jobid into v_job
  from cron.job
  where jobname = 'dailylog-compliance-reminders';
  if v_job is not null then perform cron.unschedule(v_job); end if;

  perform cron.schedule(
    'dailylog-compliance-reminders',
    '10 * * * *',
    'select public.enqueue_compliance_due_reminders();'
  );
end;
$$;
