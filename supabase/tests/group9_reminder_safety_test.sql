-- Rollback-safe Group 9 reminder eligibility, deduplication, and renewal check.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_parent uuid;
  v_autopay uuid;
  v_eligible uuid;
  v_credential uuid;
  v_result jsonb;
  v_outbox uuid;
begin
  select i.id into v_autopay
    from public.invoices i
    join public.family_billing_preferences p on p.family_id = i.family_id
   where p.autopay_enabled and i.status in ('open', 'overdue')
     and i.due_on < public.center_today() limit 1;
  select i.id into v_eligible
    from public.invoices i
    left join public.family_billing_preferences p on p.family_id = i.family_id
    join public.profiles recipient on recipient.id = i.billed_to
   where i.status in ('open', 'overdue') and i.due_on < public.center_today()
     and not coalesce(p.autopay_enabled, false)
     and nullif(btrim(recipient.email), '') is not null limit 1;
  select id into v_parent from public.profiles where role = 'parent' limit 1;
  select id into v_credential from public.staff_credentials
    where document_id is not null and completed_on is not null
      and archived_at is null limit 1;
  if v_autopay is null or v_eligible is null or v_parent is null or v_credential is null then
    raise exception 'Missing Group 9 reminder test fixtures';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  if v_autopay in (select public.get_overdue_reminder_eligible_ids()) then
    raise exception 'FAIL: autopay invoice offered for manual reminder';
  end if;
  if v_eligible not in (select public.get_overdue_reminder_eligible_ids()) then
    raise exception 'FAIL: overdue non-autopay invoice missing';
  end if;
  v_result := public.queue_overdue_invoice_reminders(array[v_autopay, v_eligible]);
  if (v_result ->> 'queued')::int <> 1 or (v_result ->> 'skipped')::int <> 1 then
    raise exception 'FAIL: expected one queued and one skipped, got %', v_result;
  end if;
  if exists (select 1 from public.invoice_reminder_events where invoice_id = v_autopay) then
    raise exception 'FAIL: autopay family received reminder history';
  end if;
  if not exists (select 1 from public.invoice_reminder_events where invoice_id = v_eligible) then
    raise exception 'FAIL: eligible invoice missing reminder history';
  end if;
  v_result := public.queue_overdue_invoice_reminders(array[v_eligible]);
  if (v_result ->> 'queued')::int <> 0 then
    raise exception 'FAIL: same-day repeat queued a duplicate';
  end if;
  update public.invoices set due_on = public.center_today() + 1 where id = v_eligible;
  if v_eligible in (select public.get_overdue_reminder_eligible_ids()) then
    raise exception 'FAIL: future-due invoice offered for reminder';
  end if;
  v_result := public.queue_overdue_invoice_reminders(array[v_eligible]);
  if (v_result ->> 'queued')::int <> 0 then
    raise exception 'FAIL: future-due invoice queued a reminder';
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  begin
    perform public.queue_overdue_invoice_reminders(array[v_eligible]);
    raise exception 'FAIL: parent queued a billing reminder';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('postgres');
  delete from public.notification_outbox
    where dedupe_key like 'credential-reminder-follow-up:' || v_credential::text || ':%';
  delete from public.notification_outbox
    where payload ->> 'credentialId' = v_credential::text
      and kind = 'credential_reminder';
  delete from public.notifications
    where payload ->> 'credentialId' = v_credential::text
      and kind = 'credential_reminder';
  perform pg_temp.impersonate('authenticated', v_owner);
  v_result := public.send_staff_credential_reminder(v_credential, true);
  if not coalesce((v_result ->> 'followUpScheduled')::boolean, false) then
    raise exception 'FAIL: credential follow-up not scheduled';
  end if;
  perform pg_temp.impersonate('postgres');
  select id into v_outbox from public.notification_outbox
    where dedupe_key like 'credential-reminder-follow-up:' || v_credential::text || ':%'
    order by created_at desc limit 1;
  update public.staff_credentials set
    completed_on = public.center_today(),
    expires_on = public.center_today() + 365
  where id = v_credential;
  if not exists (
    select 1 from public.notification_outbox
    where id = v_outbox and status = 'failed'
      and last_error like 'Cancelled:%'
  ) then
    raise exception 'FAIL: verified renewal did not cancel pending follow-up';
  end if;
end $$;

rollback;
select 'PASS: Group 9 reminders exclude autopay, dedupe, respect role, and cancel verified follow-ups' as result;
